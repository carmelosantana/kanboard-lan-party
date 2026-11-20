<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\LanParty\Model\GameRegistry;
use Kanboard\Plugin\LanParty\Plugin;

class GameRegistryRecordingLogger extends \Psr\Log\AbstractLogger
{
    public array $records = [];

    public function log($level, $message, array $context = []): void
    {
        $this->records[] = [$level, (string) $message];
    }
}

// Each test names the GameRegistry mutation it kills.
class GameRegistryTest extends Base
{
    private const FIXTURES = __DIR__.'/fixtures/games';

    private array $tmpDirs = [];

    /** The plugins root the registry under test resolves served paths against; tmpGame() moves it. */
    private string $pluginsRoot = self::FIXTURES;

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
        return new GameRegistry($this->container, $this->pluginsRoot);
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
        $this->pluginsRoot = $root;
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
            ($file->isDir() && ! $file->isLink()) ? rmdir($file->getPathname()) : unlink($file->getPathname());
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
            // Kills: a list without the other extensions PHP handlers commonly execute or serve as source.
            'php7' => ['lib/x.php7'],
            'phtml' => ['x.phtml'],
            'phar' => ['x.Phar'],
            'phps' => ['x.phps'],
        ];
    }

    public static function dotFiles(): array
    {
        return [
            // Kills: letting a game ship its own .htaccess (it could switch PHP on, or the sandbox header off).
            'htaccess' => ['.htaccess', 'forbidden path: .htaccess'],
            // Kills: checking dot-files only at the top of the folder.
            'nested' => ['art/.hidden', 'forbidden path: art/.hidden'],
            // Kills: checking files only, not dot-directories.
            'dot dir' => ['.git/config', 'forbidden path: .git'],
        ];
    }

    /** @dataProvider dotFiles */
    public function testDotFilesAreRejected(string $file, string $reason): void
    {
        $entry = $this->tmpGame();
        @mkdir(dirname($entry['path'].'/'.$file), 0777, true);
        file_put_contents($entry['path'].'/'.$file, 'x');
        $this->assertRejected($entry, $reason);
    }

    public function testBannedExtensionsMatchTheHostBridge(): void
    {
        // Kills: the PHP and JS lists drifting apart (one side would accept what the other refuses).
        $js = (string) file_get_contents(__DIR__.'/../Assets/js/lanparty-host.js');
        $this->assertSame(1, preg_match('#var BANNED_FILE = (/.+/i);#', $js, $m), 'BANNED_FILE not found in lanparty-host.js');
        $this->assertSame(GameRegistry::BANNED_FILE, $m[1]);
        $this->assertSame('/\\.(php\\d?|phtml|phar|phps|log|sqlite)$/i', GameRegistry::BANNED_FILE);
    }

    /** @dataProvider forbiddenFiles */
    public function testForbiddenExtensionsAreRejectedRecursively(string $file): void
    {
        $entry = $this->tmpGame();
        @mkdir(dirname($entry['path'].'/'.$file), 0777, true);
        file_put_contents($entry['path'].'/'.$file, 'x');
        $this->assertRejected($entry, 'forbidden file: '.$file);
    }

    public function testFolderStartingWithDataIsRejected(): void
    {
        // Kills: checking only paths inside the folder (base_url plugins/X/Games/datacenter/ hits nginx's /data rule).
        $entry = $this->tmpGame('datacenter');
        file_put_contents(
            $entry['path'].'/game.json',
            str_replace('"saltroad"', '"datacenter"', file_get_contents($entry['path'].'/game.json'))
        );
        $this->assertRejected($entry, 'forbidden path: datacenter');
    }

    public function testSymlinkedFileIsRejected(): void
    {
        // Kills: following or ignoring symlinks, which could hide a .php or data path behind an innocent name.
        $entry = $this->tmpGame();
        symlink($entry['path'].'/index.html', $entry['path'].'/alias.html');
        $this->assertRejected($entry, 'forbidden path: alias.html');
    }

    public function testSymlinkedDirectoryIsRejected(): void
    {
        // Kills: treating a symlinked directory as an ordinary subfolder.
        $entry = $this->tmpGame();
        $target = dirname($entry['path'], 3).'/outside';
        mkdir($target);
        symlink($target, $entry['path'].'/levels');
        $this->assertRejected($entry, 'forbidden path: levels');
    }

    public function testUnreadableSubfolderIsReportedNotThrown(): void
    {
        // Kills: letting RecursiveDirectoryIterator's UnexpectedValueException escape and 500 the launcher.
        $entry = $this->tmpGame();
        mkdir($entry['path'].'/locked/inner', 0777, true);
        chmod($entry['path'].'/locked', 0000);
        try {
            if (is_readable($entry['path'].'/locked')) {
                $this->markTestSkipped('running as a user that can read a 0000 directory');
            }
            $this->assertRejected($entry, 'folder unreadable');
        } finally {
            chmod($entry['path'].'/locked', 0777);
        }
    }

    public function testRejectedAndDuplicateEntriesAreLogged(): void
    {
        // Kills: skipping invalid or duplicate entries without logging the reason.
        $logger = new GameRegistryRecordingLogger();
        $this->container['logger'] = $logger;
        $dupe = $this->fixture('dupe', 'saltroad');
        $php = $this->fixture('phpfile', 'shell');
        $this->registry([$this->fixture('good', 'saltroad'), $dupe, $php])->all();

        $messages = array_column($logger->records, 1);
        $this->assertContains('LanParty: skipping '.$dupe['path'].': duplicate slug', $messages);
        $this->assertContains('LanParty: skipping '.$php['path'].': forbidden file: evil.php', $messages);
        $this->assertCount(2, array_filter($messages, fn ($m) => str_starts_with($m, 'LanParty: skipping')));
        // Kills: logging at info, which default log levels drop: an admin would never see why a game is missing.
        $this->assertSame([\Psr\Log\LogLevel::WARNING, \Psr\Log\LogLevel::WARNING], array_column($logger->records, 0));
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

    public function testGameOutsideThePluginsRootIsRejected(): void
    {
        // Kills: validating one folder while the launcher serves plugins/<plugin>/Games/<slug> from another.
        $entry = $this->tmpGame();
        $this->pluginsRoot = self::FIXTURES;
        $this->assertRejected($entry, 'not served from plugins/Tmp/Games/saltroad');
    }

    public function testPathWithDotDotIsResolvedBeforeComparing(): void
    {
        // Kills: comparing the registered path as a string; `..` must resolve to the served folder.
        $entry = $this->tmpGame();
        $entry['path'] = $this->pluginsRoot.'/Tmp/../Tmp/Games/saltroad';
        $this->assertSame(['saltroad'], array_keys($this->registry([$entry])->all()));
    }

    public function testPluginNameMustBeAnIdentifier(): void
    {
        // Kills: building base_url (plugins/<plugin>/…) from a plugin name with URL-significant characters.
        $entry = $this->tmpGame('saltroad', 'My-Games');
        $this->assertRejected($entry, 'plugin: must match ^[A-Za-z0-9_]+$');
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

    public function testPluginsRootDefaultsToPluginsDir(): void
    {
        // Kills: a default root other than PLUGINS_DIR (the shipped pop game would stop listing).
        $this->container['lanpartyGames'] = [['plugin' => 'LanParty', 'path' => dirname(__DIR__).'/Games/pop']];
        $this->assertSame(['pop'], array_keys((new GameRegistry($this->container))->all()));
        $this->container['lanpartyGames'] = [$this->fixture('good', 'saltroad')];
        $this->assertSame([], (new GameRegistry($this->container))->all());
    }

    public function testPluginRegistersServiceAndAppendsWithoutOverwriting(): void
    {
        // Kills: initialize() overwriting lanpartyGames, or not registering the gameRegistry service.
        $other = $this->fixture('good', 'saltroad');
        $this->container['lanpartyGames'] = [$other];
        (new Plugin($this->container))->initialize();

        $this->assertSame($other, $this->container['lanpartyGames'][0]);
        $this->assertInstanceOf(GameRegistry::class, $this->container['gameRegistry']);
        // The service resolves against PLUGINS_DIR: the fixture (outside it) is scanned and refused, the shipped games list.
        $shipped = array_map('basename', glob(dirname(__DIR__).'/Games/*', GLOB_ONLYDIR) ?: []);
        $this->assertContains('pop', $shipped);
        $this->assertCount(1 + count($shipped), $this->container['gameRegistry']->allForAdmin());
        $this->assertSame($shipped, array_keys($this->container['gameRegistry']->all()));
    }
}
