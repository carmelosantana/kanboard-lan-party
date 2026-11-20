<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\LanParty\Model\ManifestValidator;
use Kanboard\Plugin\LanParty\Plugin;

// The shipped sample game `pop` is the reference other game authors copy: it must pass every rule they face.
class SampleGameTest extends Base
{
    private const GAMES = __DIR__.'/../Games';
    private const POP = self::GAMES.'/pop';

    private function manifest(): array
    {
        $manifest = json_decode((string) file_get_contents(self::POP.'/game.json'), true);
        $this->assertIsArray($manifest, 'pop/game.json is not valid JSON');
        return $manifest;
    }

    /** Every file under Games/, as [game folder => [relative path, ...]]. */
    private function gameFiles(): array
    {
        $out = [];
        foreach (glob(self::GAMES.'/*', GLOB_ONLYDIR) ?: [] as $dir) {
            $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
            foreach ($files as $file) {
                $out[basename($dir)][] = substr($file->getPathname(), strlen($dir) + 1);
            }
        }
        return $out;
    }

    public function testPopManifestValidatesWithTheAgreedValues(): void
    {
        $manifest = $this->manifest();
        $this->assertSame([], (new ManifestValidator())->validate($manifest));

        $this->assertSame('pop', $manifest['slug']);
        $this->assertSame('original', $manifest['kind']);
        $this->assertSame('MIT', $manifest['licence']);
        $this->assertSame('CC-BY-4.0', $manifest['content_licence']);
        $this->assertSame('index.html', $manifest['entry']);
        $this->assertSame(['min' => 1, 'max' => 1], $manifest['players']);
        $this->assertSame(['solo', 'async'], $manifest['modes']);
        $this->assertSame(['order' => 'high', 'unit' => 'pops', 'max' => 100000], $manifest['scoring']);
        $this->assertSame([], $manifest['files']);
        $this->assertSame(['cover' => 'cover.svg', 'hero' => 'hero.svg'], $manifest['art']);
    }

    public function testPopArtIsTheAgreedShape(): void
    {
        // Cover 2:3 portrait, hero 21:9 banner, both plain SVG with no script or external reference.
        foreach (['cover.svg' => 2 / 3, 'hero.svg' => 21 / 9] as $file => $ratio) {
            $svg = (string) file_get_contents(self::POP.'/'.$file);
            $this->assertMatchesRegularExpression('/viewBox="0 0 (\d+) (\d+)"/', $svg, $file);
            preg_match('/viewBox="0 0 (\d+) (\d+)"/', $svg, $m);
            $this->assertEqualsWithDelta($ratio, $m[1] / $m[2], 0.001, $file.' aspect ratio');
            $this->assertStringNotContainsStringIgnoringCase('<script', $svg, $file);
            $this->assertStringNotContainsString('href', $svg, $file);
        }
    }

    public function testRealPluginWiringListsPop(): void
    {
        // Kills: Plugin::initialize() dropping its own Games/* glob (the Plugin test cannot see that).
        $this->container['lanpartyGames'] = [];
        (new Plugin($this->container))->initialize();

        $pop = $this->container['gameRegistry']->get('pop');
        $this->assertNotNull($pop, 'pop is not listed by the registry');
        $this->assertSame('LanParty', $pop['plugin']);
        $this->assertSame('plugins/LanParty/Games/pop/', $pop['base_url']);

        foreach ($this->container['gameRegistry']->allForAdmin() as $entry) {
            $this->assertSame([], $entry['errors'], $entry['path']);
        }
    }

    public function testNoShippedGameFileBreaksThePathRules(): void
    {
        $games = $this->gameFiles();
        $this->assertArrayHasKey('pop', $games);

        foreach ($games as $slug => $files) {
            foreach ($files as $relative) {
                $this->assertTrue(ManifestValidator::isSafeRelativePath($relative), $slug.'/'.$relative);
                $this->assertDoesNotMatchRegularExpression('/\s/', $relative, $slug.'/'.$relative);
                $this->assertDoesNotMatchRegularExpression('/\.(php\d?|phtml|phar|log|sqlite)$/i', $relative, $slug.'/'.$relative);
                $this->assertFalse(is_link(self::GAMES.'/'.$slug.'/'.$relative), $slug.'/'.$relative);
                foreach (explode('/', $slug.'/'.$relative) as $segment) {
                    $this->assertStringStartsNotWith('data', strtolower($segment), $slug.'/'.$relative);
                }
            }
        }
    }

    public function testPopFilesTheGameNeedsExist(): void
    {
        foreach (['index.html', 'pop.js', 'pop.css', 'levels.json', 'cover.svg', 'hero.svg'] as $file) {
            $this->assertFileExists(self::POP.'/'.$file);
        }
        $levels = json_decode((string) file_get_contents(self::POP.'/levels.json'), true);
        $this->assertIsArray($levels);
        $this->assertArrayHasKey('1', $levels, 'level "1" is the default level');
        foreach ($levels as $level => $config) {
            $this->assertMatchesRegularExpression('/^[A-Za-z0-9_.-]{1,32}$/', (string) $level);
            $this->assertSame(['seconds', 'every', 'radius', 'speed'], array_keys($config), 'level '.$level);
        }
    }

    public function testIndexLoadsTheSdkAndHasNoInlineScript(): void
    {
        $html = (string) file_get_contents(self::POP.'/index.html');
        $this->assertStringContainsString('<script src="../../../LanParty/Assets/js/lanparty-sdk.js"></script>', $html);

        preg_match_all('#<script\b([^>]*)>(.*?)</script>#is', $html, $scripts, PREG_SET_ORDER);
        $this->assertNotEmpty($scripts);
        foreach ($scripts as [$tag, $attrs, $body]) {
            $this->assertMatchesRegularExpression('/\bsrc="[^"]+"/', $attrs, $tag);
            $this->assertSame('', trim($body), $tag);
        }
        $this->assertDoesNotMatchRegularExpression('/<[^>]*\son[a-z]+\s*=/i', $html, 'no on*= attributes');
    }

    public function testPopMakesNoExternalRequests(): void
    {
        foreach ($this->gameFiles()['pop'] as $relative) {
            $text = (string) file_get_contents(self::POP.'/'.$relative);
            // The SVG namespace URI is an identifier, not a request.
            $text = str_replace('http://www.w3.org/2000/svg', '', $text);
            $this->assertDoesNotMatchRegularExpression('#(https?:)?//[a-z0-9.-]+\.[a-z]{2,}#i', $text, $relative);
        }
    }
}
