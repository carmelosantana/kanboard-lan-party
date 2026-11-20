<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\LanParty\Model\GameRegistry;
use Kanboard\Plugin\LanParty\Model\ManifestValidator;
use Kanboard\Plugin\LanParty\Plugin;

// Wicklings: the manifest validates, the folder passes the registry's path rules, and the page follows the
// contract (SDK first, no inline script, versioned files, no external requests).
class WicklingsGameTest extends Base
{
    private const DIR = __DIR__.'/../Games/wicklings';
    private const FILES = [
        'game.json', 'index.html', 'wicklings-sim.js', 'wicklings.js', 'wicklings.css', 'levels.json',
        'cover.svg', 'hero.svg', 'README.md',
    ];

    private function manifest(): array
    {
        $manifest = json_decode((string) file_get_contents(self::DIR.'/game.json'), true);
        $this->assertIsArray($manifest, 'wicklings/game.json is not valid JSON');
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
        sort($out);
        return $out;
    }

    public function testManifestValidatesWithTheAgreedValues(): void
    {
        $manifest = $this->manifest();
        $this->assertSame([], (new ManifestValidator())->validate($manifest));
        $this->assertSame('wicklings', $manifest['slug']);
        $this->assertSame('Wicklings', $manifest['title']);
        $this->assertSame('original', $manifest['kind']);
        $this->assertSame('MIT', $manifest['licence']);
        $this->assertSame('CC-BY-4.0', $manifest['content_licence']);
        $this->assertSame('index.html', $manifest['entry']);
        $this->assertSame(['cover' => 'cover.svg', 'hero' => 'hero.svg'], $manifest['art']);
        $this->assertSame(['min' => 1, 'max' => 1], $manifest['players']);
        $this->assertSame(['solo', 'async'], $manifest['modes']);
        // 40 wicklings x 100 + 300 seconds x 10: the most any level the parser accepts can score.
        $this->assertSame(['order' => 'high', 'unit' => 'wicks', 'max' => 7000], $manifest['scoring']);
        $this->assertSame([], $manifest['files']);
    }

    public function testTheGameShipsExactlyItsFilesAndEachPassesThePathRules(): void
    {
        $expected = self::FILES;
        sort($expected);
        $this->assertSame($expected, $this->files());
        foreach ($this->files() as $relative) {
            $this->assertTrue(ManifestValidator::isSafeRelativePath($relative), $relative);
            $this->assertDoesNotMatchRegularExpression(GameRegistry::BANNED_FILE, $relative);
            $this->assertFalse(is_link(self::DIR.'/'.$relative), $relative);
            foreach (explode('/', 'wicklings/'.$relative) as $segment) {
                $this->assertStringStartsNotWith('data', strtolower($segment), $relative);
            }
        }
    }

    public function testRegistryListsWicklingsWithoutErrors(): void
    {
        $this->container['lanpartyGames'] = [];
        (new Plugin($this->container))->initialize();

        $game = $this->container['gameRegistry']->get('wicklings');
        $this->assertNotNull($game, 'wicklings is not listed by the registry');
        $this->assertSame('plugins/LanParty/Games/wicklings/', $game['base_url']);
        foreach ($this->container['gameRegistry']->allForAdmin() as $entry) {
            $this->assertSame([], $entry['errors'], $entry['path']);
        }
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
        $this->assertStringContainsString('<link rel="stylesheet" href="wicklings.css'.$v.'">', $html);
        $this->assertStringContainsString('<script src="wicklings-sim.js'.$v.'"></script>', $html);
        $this->assertStringContainsString('<script src="wicklings.js'.$v.'"></script>', $html);
    }

    public function testLevelsFileHoldsTwelveLevelsWithScoreSafeIds(): void
    {
        $levels = json_decode((string) file_get_contents(self::DIR.'/levels.json'), true);
        $this->assertIsArray($levels);
        $this->assertCount(12, $levels['levels']);
        foreach ($levels['levels'] as $level) {
            // The level id travels as the score's `level` and in challenge links.
            $this->assertMatchesRegularExpression('/^[A-Za-z0-9_.-]{1,32}$/', $level['id']);
        }
    }

    public function testMakesNoExternalRequests(): void
    {
        foreach ($this->files() as $relative) {
            $text = str_replace('http://www.w3.org/2000/svg', '', (string) file_get_contents(self::DIR.'/'.$relative));
            $this->assertDoesNotMatchRegularExpression('#(https?:)?//[a-z0-9.-]+\.[a-z]{2,}#i', $text, $relative);
        }
    }
}
