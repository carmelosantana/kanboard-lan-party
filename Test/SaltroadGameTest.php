<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\LanParty\Model\GameRegistry;
use Kanboard\Plugin\LanParty\Model\ManifestValidator;
use Kanboard\Plugin\LanParty\Plugin;

// Saltroad, the trail-journey original: it must pass every rule the registry and the game contract set.
class SaltroadGameTest extends Base
{
    private const DIR = __DIR__.'/../Games/saltroad';

    private function manifest(): array
    {
        $manifest = json_decode((string) file_get_contents(self::DIR.'/game.json'), true);
        $this->assertIsArray($manifest, 'saltroad/game.json is not valid JSON');
        return $manifest;
    }

    /** Every file in the game folder, relative to it. */
    private function files(): array
    {
        $out = [];
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(self::DIR, FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            $out[] = substr($file->getPathname(), strlen(self::DIR) + 1);
        }
        sort($out);
        return $out;
    }

    public function testManifestValidatesWithTheAgreedValues(): void
    {
        $manifest = $this->manifest();
        $this->assertSame([], (new ManifestValidator())->validate($manifest));

        $this->assertSame('saltroad', $manifest['slug']);
        $this->assertSame('Saltroad', $manifest['title']);
        $this->assertSame('original', $manifest['kind']);
        $this->assertSame('MIT', $manifest['licence']);
        $this->assertSame('CC-BY-4.0', $manifest['content_licence']);
        $this->assertSame('index.html', $manifest['entry']);
        $this->assertSame(['min' => 1, 'max' => 1], $manifest['players']);
        $this->assertSame(['solo', 'async'], $manifest['modes']);
        $this->assertSame(['order' => 'high', 'unit' => 'bars', 'max' => 10000], $manifest['scoring']);
        $this->assertSame([], $manifest['files']);
        $this->assertSame(['cover' => 'cover.svg', 'hero' => 'hero.svg'], $manifest['art']);
    }

    public function testThePluginListsSaltroadWithoutErrors(): void
    {
        $this->container['lanpartyGames'] = [];
        (new Plugin($this->container))->initialize();

        $game = $this->container['gameRegistry']->get('saltroad');
        $this->assertNotNull($game, 'saltroad is not listed by the registry');
        $this->assertSame('LanParty', $game['plugin']);
        $this->assertSame('plugins/LanParty/Games/saltroad/', $game['base_url']);
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

    public function testEveryFileFollowsThePathRules(): void
    {
        $files = $this->files();
        foreach (['index.html', 'saltroad.js', 'saltroad-core.js', 'saltroad.css', 'routes.json', 'cover.svg', 'hero.svg', 'README.md'] as $needed) {
            $this->assertContains($needed, $files);
        }
        foreach ($files as $relative) {
            $this->assertTrue(ManifestValidator::isSafeRelativePath($relative), $relative);
            $this->assertMatchesRegularExpression('/^[A-Za-z0-9_.\/-]+$/', $relative);
            $this->assertDoesNotMatchRegularExpression(GameRegistry::BANNED_FILE, $relative);
            $this->assertFalse(is_link(self::DIR.'/'.$relative), $relative);
            foreach (explode('/', 'saltroad/'.$relative) as $segment) {
                $this->assertStringStartsNotWith('data', strtolower($segment), $relative);
                $this->assertStringStartsNotWith('.', $segment, $relative);
            }
        }
    }

    public function testRoutesHaveTheShortAndLongLevels(): void
    {
        $routes = json_decode((string) file_get_contents(self::DIR.'/routes.json'), true);
        $this->assertIsArray($routes);
        $this->assertSame(['1', '2'], array_map('strval', array_keys($routes)));
        $this->assertLessThan(count($routes['2']['waypoints']), count($routes['1']['waypoints']));
        foreach ($routes as $level => $route) {
            $this->assertSame(['name', 'deadline', 'waypoints'], array_keys($route), 'route '.$level);
        }
    }

    public function testIndexLoadsTheSdkFirstAndHasNoInlineScript(): void
    {
        $html = (string) file_get_contents(self::DIR.'/index.html');
        preg_match('#<script\b[^>]*>#i', $html, $first);
        $this->assertSame('<script src="../../../LanParty/Assets/js/lanparty-sdk.js?v='.(new Plugin($this->container))->getPluginVersion().'">', $first[0] ?? null);

        preg_match_all('#<script\b([^>]*)>(.*?)</script>#is', $html, $scripts, PREG_SET_ORDER);
        $this->assertCount(3, $scripts);
        foreach ($scripts as [$tag, $attrs, $body]) {
            $this->assertMatchesRegularExpression('/\bsrc="[^"]+"/', $attrs, $tag);
            $this->assertSame('', trim($body), $tag);
        }
        $this->assertDoesNotMatchRegularExpression('/<[^>]*\son[a-z]+\s*=/i', $html, 'no on*= attributes');
        $this->assertStringNotContainsString(' style=', $html, 'styles live in saltroad.css');
    }

    public function testCampHintsAndConfirmLiveInThePage(): void
    {
        $html = (string) file_get_contents(self::DIR.'/index.html');
        // Kills: pace and ration numbers typed into the page, where a balance change would leave them stale.
        $this->assertDoesNotMatchRegularExpression('/\\d+\\s*(mi|food|water)\\b/', $html);
        foreach (['steady', 'hard', 'rest', 'full', 'half', 'lean'] as $key) {
            $this->assertStringContainsString('id="hint-'.$key.'"', $html);
        }
        // Kills: a new start replacing a saved journey with no in-page confirmation (window.confirm is sandboxed off).
        $this->assertMatchesRegularExpression('/<section id="confirm"[^>]*role="alertdialog"/', $html);
        $this->assertStringContainsString('id="confirm-start"', $html);
        $this->assertStringContainsString('id="confirm-keep"', $html);
        $js = (string) file_get_contents(self::DIR.'/saltroad.js');
        $this->assertStringNotContainsString('confirm(', str_replace(['showConfirm(', 'abandonConfirm('], '', $js));
    }

    public function testVersionsItsOwnScriptsAndStyles(): void
    {
        $html = (string) file_get_contents(self::DIR.'/index.html');
        $v = '?v='.$this->manifest()['version'];
        $this->assertStringContainsString('<link rel="stylesheet" href="saltroad.css'.$v.'">', $html);
        $this->assertStringContainsString('<script src="saltroad-core.js'.$v.'"></script>', $html);
        $this->assertStringContainsString('<script src="saltroad.js'.$v.'"></script>', $html);
    }

    public function testMakesNoExternalRequests(): void
    {
        foreach ($this->files() as $relative) {
            if ($relative === 'README.md') {
                continue; // prose, never loaded by the game
            }
            $text = str_replace('http://www.w3.org/2000/svg', '', (string) file_get_contents(self::DIR.'/'.$relative));
            $this->assertDoesNotMatchRegularExpression('#(https?:)?//[a-z0-9.-]+\.[a-z]{2,}#i', $text, $relative);
            $this->assertDoesNotMatchRegularExpression('/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB)\b/', $text, $relative);
        }
    }
}
