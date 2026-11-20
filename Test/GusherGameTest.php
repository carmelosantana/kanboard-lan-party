<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\LanParty\Model\GameRegistry;
use Kanboard\Plugin\LanParty\Model\ManifestValidator;
use Kanboard\Plugin\LanParty\Plugin;

// Gusher, the oil pipe-flow puzzle: its manifest, folder and entry page follow the game contract.
class GusherGameTest extends Base
{
    private const DIR = __DIR__.'/../Games/gusher';

    private function manifest(): array
    {
        $manifest = json_decode((string) file_get_contents(self::DIR.'/game.json'), true);
        $this->assertIsArray($manifest, 'gusher/game.json is not valid JSON');
        return $manifest;
    }

    /** @return string[] every file in the game folder, relative to it */
    private function files(): array
    {
        $out = [];
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(self::DIR, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            $out[] = substr($file->getPathname(), strlen(self::DIR) + 1);
        }
        return $out;
    }

    public function testManifestValidatesWithTheAgreedValues(): void
    {
        $manifest = $this->manifest();
        $this->assertSame([], (new ManifestValidator())->validate($manifest));
        $this->assertSame('gusher', $manifest['slug']);
        $this->assertSame('original', $manifest['kind']);
        $this->assertSame('MIT', $manifest['licence']);
        $this->assertSame('CC-BY-4.0', $manifest['content_licence']);
        $this->assertSame(['min' => 1, 'max' => 1], $manifest['players']);
        $this->assertSame(['solo', 'async'], $manifest['modes']);
        $this->assertSame(['order' => 'high', 'unit' => 'barrels', 'max' => 10000], $manifest['scoring']);
        $this->assertSame([], $manifest['files']);
        $this->assertSame(['cover' => 'cover.svg', 'hero' => 'hero.svg'], $manifest['art']);
    }

    public function testRegistryListsGusherWithoutErrors(): void
    {
        $this->container['lanpartyGames'] = [];
        (new Plugin($this->container))->initialize();

        $game = $this->container['gameRegistry']->get('gusher');
        $this->assertNotNull($game, 'gusher is not listed by the registry');
        $this->assertSame('plugins/LanParty/Games/gusher/', $game['base_url']);
        foreach ($this->container['gameRegistry']->allForAdmin() as $entry) {
            $this->assertSame([], $entry['errors'], $entry['path']);
        }
    }

    public function testEveryFilePassesThePathRules(): void
    {
        foreach ($this->files() as $relative) {
            $this->assertTrue(ManifestValidator::isSafeRelativePath($relative), $relative);
            $this->assertDoesNotMatchRegularExpression('/\s/', $relative, $relative);
            $this->assertDoesNotMatchRegularExpression(GameRegistry::BANNED_FILE, $relative, $relative);
            $this->assertFalse(is_link(self::DIR.'/'.$relative), $relative);
            foreach (explode('/', 'gusher/'.$relative) as $segment) {
                $this->assertStringStartsNotWith('data', strtolower($segment), $relative);
            }
        }
    }

    public function testFilesTheGameNeedsExist(): void
    {
        foreach (['index.html', 'gusher-logic.js', 'gusher.js', 'gusher.css', 'levels.json', 'cover.svg', 'hero.svg', 'README.md'] as $file) {
            $this->assertFileExists(self::DIR.'/'.$file);
        }
        $levels = json_decode((string) file_get_contents(self::DIR.'/levels.json'), true);
        $this->assertSame(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], array_map('strval', array_keys($levels)));
    }

    public function testArtIsTheAgreedShape(): void
    {
        foreach (['cover.svg' => 2 / 3, 'hero.svg' => 21 / 9] as $file => $ratio) {
            $svg = (string) file_get_contents(self::DIR.'/'.$file);
            $this->assertMatchesRegularExpression('/viewBox="0 0 (\d+) (\d+)"/', $svg, $file);
            preg_match('/viewBox="0 0 (\d+) (\d+)"/', $svg, $m);
            $this->assertEqualsWithDelta($ratio, $m[1] / $m[2], 0.001, $file.' aspect ratio');
            $this->assertStringNotContainsStringIgnoringCase('<script', $svg, $file);
            $this->assertStringNotContainsString('href', $svg, $file);
        }
    }

    public function testIndexLoadsTheSdkFirstWithVersionedFilesAndNoInlineScript(): void
    {
        $html = (string) file_get_contents(self::DIR.'/index.html');
        preg_match('#<script\b[^>]*>#i', $html, $first);
        $this->assertSame('<script src="../../../LanParty/Assets/js/lanparty-sdk.js?v='.(new Plugin($this->container))->getPluginVersion().'">', $first[0] ?? null);

        preg_match_all('#<script\b([^>]*)>(.*?)</script>#is', $html, $scripts, PREG_SET_ORDER);
        foreach ($scripts as [$tag, $attrs, $body]) {
            $this->assertMatchesRegularExpression('/\bsrc="[^"]+"/', $attrs, $tag);
            $this->assertSame('', trim($body), $tag);
        }
        $this->assertDoesNotMatchRegularExpression('/<[^>]*\son[a-z]+\s*=/i', $html, 'no on*= attributes');

        $v = '?v='.$this->manifest()['version'];
        $this->assertStringContainsString('<link rel="stylesheet" href="gusher.css'.$v.'">', $html);
        $this->assertStringContainsString('<script src="gusher-logic.js'.$v.'"></script>', $html);
        $this->assertStringContainsString('<script src="gusher.js'.$v.'"></script>', $html);
        $this->assertLessThan(strpos($html, 'gusher.js'.$v), strpos($html, 'gusher-logic.js'.$v), 'logic loads before the game');
    }

    public function testMakesNoExternalRequests(): void
    {
        foreach ($this->files() as $relative) {
            $text = str_replace('http://www.w3.org/2000/svg', '', (string) file_get_contents(self::DIR.'/'.$relative));
            $this->assertDoesNotMatchRegularExpression('#(https?:)?//[a-z0-9.-]+\.[a-z]{2,}#i', $text, $relative);
        }
    }
}
