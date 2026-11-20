<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\LanParty\Model\GameRegistry;
use Kanboard\Plugin\LanParty\Plugin;

// Each test names the GameRegistry mutation it kills.
class GameRegistryTest extends Base
{
    private const FIXTURES = __DIR__.'/fixtures/games';

    private array $tmpDirs = [];

    protected function tearDown(): void
    {
        foreach ($this->tmpDirs as $dir) {
            $this->removeTree($dir);
        }
        parent::tearDown();
    }

    private function fixture(string $case, string $slug): array
    {
        return ['plugin' => $case, 'path' => self::FIXTURES.'/'.$case.'/Games/'.$slug];
    }

    private function registry(array $entries): GameRegistry
    {
        $this->container['lanpartyGames'] = $entries;
        return new GameRegistry($this->container);
    }

    private function adminEntry(GameRegistry $registry, string $path): array
    {
        foreach ($registry->allForAdmin() as $entry) {
            if ($entry['path'] === $path) {
                return $entry;
            }
        }
        $this->fail('no admin entry for '.$path);
    }

    /** Copies the good saltroad game into a fresh <tmp>/<plugin>/Games/<folder> and returns its entry. */
    private function tmpGame(string $folder = 'saltroad', string $plugin = 'Tmp'): array
    {
        $root = sys_get_temp_dir().'/lanparty-test-'.bin2hex(random_bytes(6));
        $this->tmpDirs[] = $root;
        $path = $root.'/'.$plugin.'/Games/'.$folder;
        mkdir($path, 0777, true);
        copy(self::FIXTURES.'/good/Games/saltroad/game.json', $path.'/game.json');
        copy(self::FIXTURES.'/good/Games/saltroad/index.html', $path.'/index.html');
        return ['plugin' => $plugin, 'path' => $path];
    }

    private function removeTree(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($it as $file) {
            $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
        }
        rmdir($dir);
    }

    private function assertRejected(array $entry, string $reason): void
    {
        $registry = $this->registry([$entry]);
        $this->assertSame([], $registry->all());
        $errors = $this->adminEntry($registry, $entry['path'])['errors'];
        $this->assertNotEmpty(
            array_filter($errors, fn (string $e) => str_contains($e, $reason)),
            'expected "'.$reason.'" in '.json_encode($errors)
        );
    }

    public function testGoodGameIsListedWithPluginBaseUrlAndPath(): void
    {
        // Kills: base_url built from the wrong segment, or plugin/path not merged into the game.
        $entry = $this->fixture('good', 'saltroad');
        $game = $this->registry([$entry])->all()['saltroad'];

        $this->assertSame('Saltroad', $game['title']);
        $this->assertSame('good', $game['plugin']);
        $this->assertSame('plugins/good/Games/saltroad/', $game['base_url']);
        $this->assertSame($entry['path'], $game['path']);
    }

    public function testGamesKeepRegistrationOrder(): void
    {
        // Kills: sorting all() by slug instead of keeping registration order.
        $games = $this->registry([$this->fixture('good', 'saltroad'), $this->fixture('good', 'pinball')])->all();
        $this->assertSame(['saltroad', 'pinball'], array_keys($games));
    }

    public function testDuplicateSlugFirstRegistrationWins(): void
    {
        // Kills: letting the later duplicate overwrite the first.
        $first = $this->fixture('good', 'saltroad');
        $second = $this->fixture('dupe', 'saltroad');
        $registry = $this->registry([$first, $second]);

        $this->assertSame('good', $registry->all()['saltroad']['plugin']);
        $this->assertSame('Saltroad', $registry->get('saltroad')['title']);
        $this->assertCount(2, $registry->allForAdmin());
        $this->assertSame([], $this->adminEntry($registry, $first['path'])['errors']);
        $this->assertSame(['duplicate slug'], $this->adminEntry($registry, $second['path'])['errors']);
    }

    public function testInvalidManifestIsRejectedWithValidatorErrors(): void
    {
        // Kills: skipping ManifestValidator.
        $this->assertRejected($this->fixture('bad', 'broken'), 'kind: ');
    }

    public function testDataPathSegmentIsRejected(): void
    {
        // Kills: removing the /data segment check (levels/database.json).
        $this->assertRejected($this->fixture('datapath', 'levelpack'), 'forbidden path: levels/database.json');
    }

    public function testDataDirectoryIsRejectedCaseInsensitively(): void
    {
        // Kills: a case-sensitive or files-only data check.
        $entry = $this->tmpGame();
        mkdir($entry['path'].'/Data');
        $this->assertRejected($entry, 'forbidden path: Data');
    }

    public function testPhpFileIsRejected(): void
    {
        // Kills: removing .php from the forbidden extensions.
        $this->assertRejected($this->fixture('phpfile', 'shell'), 'forbidden file: evil.php');
    }

    public static function forbiddenFiles(): array
    {
        return [
            // Kills: removing .log from the forbidden extensions.
            'log' => ['art/debug.log'],
            // Kills: removing .sqlite from the forbidden extensions.
            'sqlite' => ['scores.sqlite'],
            // Kills: a case-sensitive extension check.
            'upper php' => ['art/x.PHP'],
        ];
    }

    /** @dataProvider forbiddenFiles */
    public function testForbiddenExtensionsAreRejectedRecursively(string $file): void
    {
        $entry = $this->tmpGame();
        @mkdir(dirname($entry['path'].'/'.$file), 0777, true);
        file_put_contents($entry['path'].'/'.$file, 'x');
        $this->assertRejected($entry, 'forbidden file: '.$file);
    }

    public function testMissingManifestIsRejected(): void
    {
        // Kills: treating a folder without game.json as an empty manifest.
        $entry = $this->tmpGame();
        unlink($entry['path'].'/game.json');
        $this->assertRejected($entry, 'game.json missing');
    }

    public function testInvalidJsonIsRejected(): void
    {
        // Kills: dropping the json_decode failure check.
        $entry = $this->tmpGame();
        file_put_contents($entry['path'].'/game.json', '{"slug": ');
        $this->assertRejected($entry, 'game.json is not valid JSON');
    }

    public function testSlugMustMatchFolder(): void
    {
        // Kills: removing the slug == folder name check.
        $this->assertRejected($this->tmpGame('caravan'), 'slug does not match folder');
    }

    public function testPluginMustMatchPathSegment(): void
    {
        // Kills: trusting the entry's plugin value over its path.
        $entry = $this->tmpGame();
        $entry['plugin'] = 'Other';
        $this->assertRejected($entry, 'plugin does not match path');
    }

    public function testPathNotUnderPluginGamesIsRejected(): void
    {
        // Kills: not requiring the <plugin>/Games/<slug> shape before building base_url.
        $entry = $this->tmpGame();
        $moved = dirname($entry['path'], 2).'/Levels/saltroad';
        mkdir(dirname($moved));
        rename($entry['path'], $moved);
        $this->assertRejected(['plugin' => 'Tmp', 'path' => $moved], 'path must be <plugin>/Games/<slug>');
    }

    public function testMissingFolderIsRejected(): void
    {
        // Kills: scanning a non-existent folder as if it were empty.
        $this->assertRejected(['plugin' => 'good', 'path' => self::FIXTURES.'/good/Games/nowhere'], 'folder missing');
    }

    public function testMalformedEntryIsRejected(): void
    {
        // Kills: indexing plugin/path without checking the entry shape.
        $registry = $this->registry([['path' => 5]]);
        $this->assertSame([], $registry->all());
        $this->assertSame(['entry needs plugin and path strings'], $registry->allForAdmin()[0]['errors']);
    }

    public function testDisabledGameIsHiddenFromPlayersButListedForAdmins(): void
    {
        // Kills: setEnabled() not persisting, all()/get() ignoring lanparty_disabled, or a stale memoised config.
        $saltroad = $this->fixture('good', 'saltroad');
        $registry = $this->registry([$saltroad, $this->fixture('good', 'pinball')]);
        $this->assertNotNull($registry->get('saltroad'));

        $registry->setEnabled('saltroad', false);

        $this->assertSame('saltroad', $this->container['configModel']->get('lanparty_disabled'));
        $this->assertSame(['pinball'], array_keys($registry->all()));
        $this->assertNull($registry->get('saltroad'));
        $admin = $this->adminEntry($registry, $saltroad['path']);
        $this->assertFalse($admin['enabled']);
        $this->assertSame([], $admin['errors']);

        $registry->setEnabled('saltroad', true);
        $this->assertSame(['saltroad', 'pinball'], array_keys($registry->all()));
        $this->assertTrue($this->adminEntry($registry, $saltroad['path'])['enabled']);
    }

    public function testDisablingTwoGamesStoresCsv(): void
    {
        // Kills: setEnabled() replacing the CSV instead of adding to it.
        $registry = $this->registry([$this->fixture('good', 'saltroad'), $this->fixture('good', 'pinball')]);
        $registry->setEnabled('saltroad', false);
        $registry->setEnabled('pinball', false);
        $this->assertSame('saltroad,pinball', $this->container['configModel']->get('lanparty_disabled'));
        $this->assertSame([], $registry->all());
    }

    public function testGetUnknownSlugIsNull(): void
    {
        // Kills: get() returning an invalid or unregistered game.
        $registry = $this->registry([$this->fixture('bad', 'broken')]);
        $this->assertNull($registry->get('broken'));
        $this->assertNull($registry->get('nope'));
    }

    public function testEmptyOrMissingContainerKeyGivesNoGames(): void
    {
        // Kills: reading container['lanpartyGames'] without an existence check.
        $this->assertSame([], $this->registry([])->all());
        unset($this->container['lanpartyGames']);
        $registry = new GameRegistry($this->container);
        $this->assertSame([], $registry->all());
        $this->assertSame([], $registry->allForAdmin());
    }

    public function testPluginRegistersServiceAndAppendsWithoutOverwriting(): void
    {
        // Kills: initialize() overwriting lanpartyGames, or not registering the gameRegistry service.
        $other = $this->fixture('good', 'saltroad');
        $this->container['lanpartyGames'] = [$other];
        (new Plugin($this->container))->initialize();

        $this->assertSame($other, $this->container['lanpartyGames'][0]);
        $this->assertInstanceOf(GameRegistry::class, $this->container['gameRegistry']);
        $this->assertSame('good', $this->container['gameRegistry']->get('saltroad')['plugin']);
    }
}
