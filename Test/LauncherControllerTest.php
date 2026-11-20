<?php
require_once 'tests/units/Base.php';
require_once __DIR__.'/EndpointHarness.php';

use KanboardTests\units\Base;
use Kanboard\Core\Controller\PageNotFoundException;
use Kanboard\Core\Http\Response;
use Kanboard\Plugin\LanParty\Controller\LauncherController;
use Kanboard\Plugin\LanParty\Model\ScoreModel;
use Kanboard\Plugin\LanParty\Plugin;

// Renders the real launcher templates; each test names the LauncherController/template mutation it kills.
class LauncherControllerTest extends Base
{
    use EndpointHarness;

    private const ENGINE = ['plugin' => 'engines', 'path' => __DIR__.'/fixtures/games/engines/Games/doomish'];

    protected function setUp(): void
    {
        parent::setUp();
        (new Plugin($this->container))->initialize();
        $this->setUpEndpoints();
    }

    private function render(string $action, array $get = []): string
    {
        $this->get($get);
        $html = '';
        $resp = $this->createMock(Response::class);
        $resp->method('html')->willReturnCallback(function ($out) use (&$html) { $html = (string) $out; });
        $this->container['response'] = $resp;
        (new LauncherController($this->container))->$action();
        return $html;
    }

    /** Re-register games and drop the memoised registry (Pimple freezes a service once it is read). */
    private function games(array $registrations): void
    {
        $this->container['lanpartyGames'] = $registrations;
        unset($this->container['gameRegistry']);
        $this->container['gameRegistry'] = fn ($c) => new \Kanboard\Plugin\LanParty\Model\GameRegistry($c);
    }

    private function withEngine(): void
    {
        $this->games(array_merge($this->container['lanpartyGames'], [self::ENGINE]));
    }

    /** No inline <script> (one without src) and no on*= handler attribute: Kanboard's CSP blocks both. */
    private function assertCspSafe(string $html): void
    {
        $this->assertDoesNotMatchRegularExpression('/<script(?![^>]*\bsrc=)[^>]*>/i', $html, 'inline <script>');
        $this->assertDoesNotMatchRegularExpression('/<[^>]+\son[a-z]+\s*=/i', $html, 'on*= attribute');
    }

    // Kills: a card that drops the title, or a cover src built without url->dir() + base_url + art.cover.
    public function testIndexListsGameTitleAndCover(): void
    {
        $html = $this->render('index');
        $this->assertStringContainsString('Arcade', $html);
        $this->assertStringContainsString('src="/plugins/scored/Games/arcade/cover.svg"', $html);
        $this->assertStringContainsString('LAN Party Originals', $html);
        $this->assertStringContainsString('href="/?controller=LauncherController&amp;action=game&amp;plugin=LanParty&amp;slug=arcade"', $html);
        $this->assertCspSafe($html);
    }

    // Kills: always rendering the Engine games row (absent) or never rendering it (present).
    public function testEngineRowOnlyWithEngineGames(): void
    {
        $this->assertStringNotContainsString('Engine games', $this->render('index'));
        $this->withEngine();
        $html = $this->render('index');
        $this->assertStringContainsString('Engine games', $html);
        $this->assertStringContainsString('Doomish', $html);
    }

    // Kills: listing from allForAdmin() (or ignoring the disabled list) instead of all().
    public function testDisabledGameIsAbsent(): void
    {
        $this->container['gameRegistry']->setEnabled('arcade', false);
        $html = $this->render('index');
        $this->assertStringNotContainsString('Arcade', $html);
        $this->assertStringContainsString('Saltroad', $html);
    }

    // Kills: rendering an empty page (or erroring) when no game is registered.
    public function testEmptyState(): void
    {
        $this->games([]);
        $this->assertStringContainsString('No games installed', $this->render('index'));
    }

    // Kills: a Continue playing row that ignores playedSlugs(), and a card without the player's best score.
    public function testContinuePlayingRowAndBest(): void
    {
        $this->assertStringNotContainsString('Continue playing', $this->render('index'));
        $game = $this->container['gameRegistry']->get('arcade');
        (new ScoreModel($this->container))->submit($game, 2, 640, null, null, null);
        $html = $this->render('index');
        $this->assertStringContainsString('Continue playing', $html);
        $this->assertStringContainsString('640', $html);
    }

    // Kills: a hero that ignores mostPlayedSince() and always shows the first original.
    public function testHeroIsMostPlayedThisWeek(): void
    {
        $this->games(array_reverse($this->container['lanpartyGames']));
        $this->assertMatchesRegularExpression('/class="lp-hero".*?<h1[^>]*>Saltroad</s', $this->render('index'));
        $game = $this->container['gameRegistry']->get('arcade');
        (new ScoreModel($this->container))->submit($game, 2, 5, null, null, null);
        $this->assertMatchesRegularExpression('/class="lp-hero".*?<h1[^>]*>Arcade</s', $this->render('index'));
    }

    // Kills: a badge that prints "1–1P" or a hyphen instead of the en dash.
    public function testPlayersBadge(): void
    {
        $this->withEngine();
        $html = $this->render('index');
        $this->assertStringContainsString('>1P<', $html);
        $this->assertStringContainsString('>1–4P<', $html);
    }

    // Kills: rendering a page (or a disabled game) for a slug the registry does not list.
    public function testGamePageUnknownSlugIs404(): void
    {
        try {
            $this->render('game', ['slug' => 'nosuch']);
            $this->fail('expected 404');
        } catch (PageNotFoundException $e) {
        }
        $this->container['gameRegistry']->setEnabled('arcade', false);
        $this->expectException(PageNotFoundException::class);
        $this->render('game', ['slug' => 'arcade']);
    }

    // Kills: dropping or mis-building any of the four Play button attributes, or an inline script/handler.
    public function testPlayButtonDataAttributesAndCsp(): void
    {
        $this->withEngine();
        $html = $this->render('game', ['slug' => 'doomish']);
        $this->assertCspSafe($html);
        $this->assertStringContainsString('data-lp-slug="doomish"', $html);
        $this->assertStringContainsString('data-lp-src="/plugins/engines/Games/doomish/play/index.html"', $html);
        // Reusable tokens are nonce-signed (a fresh string per call): check it validates rather than compare.
        $this->assertSame(1, preg_match('/data-lp-csrf="([0-9a-f]+)"/', $html, $csrf));
        $this->assertTrue($this->container['token']->validateReusableCSRFToken($csrf[1]));

        $this->assertMatchesRegularExpression('/data-lp-endpoints="([^"]+)"/', $html);
        preg_match('/data-lp-endpoints="([^"]+)"/', $html, $m);
        $endpoints = json_decode(html_entity_decode($m[1], ENT_QUOTES), true);
        $this->assertSame(['score', 'scores', 'save', 'load'], array_keys($endpoints));
        $this->assertSame('/?controller=ScoreController&action=board&slug=doomish&plugin=LanParty', $endpoints['scores']);
        $this->assertSame('/?controller=SaveController&action=load&slug=doomish&plugin=LanParty', $endpoints['load']);
        $this->assertSame('/?controller=ScoreController&action=submit&plugin=LanParty', $endpoints['score']);
        $this->assertSame('/?controller=SaveController&action=save&plugin=LanParty', $endpoints['save']);

        // Tagline is escaped; licences are shown.
        $this->assertStringContainsString('Rip &amp; tear &lt;b&gt;politely&lt;/b&gt;', $html);
        $this->assertStringContainsString('GPL-2.0', $html);
        $this->assertStringContainsString('BSD-3-Clause', $html);
    }

    // Kills: a leaderboard that is not server-rendered, or shows only one of the two periods.
    public function testGamePageLeaderboard(): void
    {
        $game = $this->container['gameRegistry']->get('arcade');
        (new ScoreModel($this->container))->submit($game, 2, 640, null, null, null);
        $html = $this->render('game', ['slug' => 'arcade']);
        $this->assertStringContainsString('All time', $html);
        $this->assertStringContainsString('This week', $html);
        $this->assertSame(2, substr_count($html, '<td class="lp-board-score">640</td>'));
    }

    // Kills: a banner shown for an unknown user, one without the challenger's best, or unescaped level/seed.
    public function testChallengeBanner(): void
    {
        $game = $this->container['gameRegistry']->get('arcade');
        (new ScoreModel($this->container))->submit($game, 2, 640, null, null, null);
        $html = $this->render('game', ['slug' => 'arcade', 'level' => '<i>x</i>', 'seed' => 's1', 'from' => '2']);
        $this->assertStringContainsString('Beat Amy’s 640', $html);
        $this->assertStringContainsString('&lt;i&gt;x&lt;/i&gt;', $html);
        $this->assertStringNotContainsString('<i>x</i>', $html);
        $this->assertCspSafe($html);

        $this->assertStringNotContainsString('Beat ', $this->render('game', ['slug' => 'arcade', 'level' => '1', 'seed' => 's', 'from' => '99']));
        $this->assertStringNotContainsString('Beat ', $this->render('game', ['slug' => 'arcade', 'from' => '2']));
    }

    // Kills: injecting lanparty.css sitewide instead of only on launcher pages.
    public function testCssOnlyOnLauncherPages(): void
    {
        $css = 'plugins/LanParty/Assets/css/lanparty.css';
        $this->assertStringNotContainsString($css, $this->container['helper']->hook->asset('css', 'template:layout:css'));
        $this->assertStringContainsString($css, $this->render('index'));
    }

    // Kills: dropping a frozen launcher route or wiring it to the wrong action.
    public function testLauncherRoutes(): void
    {
        $route = $this->container['route'];
        $route->enable();
        (new Plugin($this->container))->initialize();
        $this->assertSame(['controller' => 'LauncherController', 'action' => 'index', 'plugin' => 'LanParty'], $route->findRoute('lanparty'));
        $this->assertSame(['controller' => 'LauncherController', 'action' => 'game', 'plugin' => 'LanParty'], $route->findRoute('lanparty/game/arcade'));
    }

    // Kills: forgetting either entry-point hook (header avatar menu, dashboard sidebar).
    public function testEntryPointHooks(): void
    {
        $user = $this->container['userModel']->getById(2);
        foreach (['template:header:dropdown', 'template:dashboard:sidebar'] as $hook) {
            $out = $this->container['helper']->hook->render($hook, ['user' => $user]);
            $this->assertStringContainsString('LAN Party', $out, $hook);
            $this->assertStringContainsString('LauncherController', $out, $hook);
        }
    }
}
