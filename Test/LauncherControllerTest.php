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
        $this->container['gameRegistry'] = fn ($c) => new \Kanboard\Plugin\LanParty\Model\GameRegistry($c, __DIR__.'/fixtures/games');
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

    // Kills: a hero that falls back to the first original when the most-played game is disabled or no longer
    // registered, instead of taking the next most-played game that is listed.
    public function testHeroSkipsMostPlayedGamesThatAreNotListed(): void
    {
        $this->withEngine();
        $db = $this->container['db'];
        foreach (['gone' => 4, 'arcade' => 3, 'doomish' => 2, 'saltroad' => 1] as $slug => $plays) {
            for ($i = 0; $i < $plays; $i++) {
                $db->table(ScoreModel::TABLE)->insert(['game_slug' => $slug, 'user_id' => 2, 'score' => 1, 'created_at' => time()]);
            }
        }
        $this->assertMatchesRegularExpression('/class="lp-hero".*?<h1[^>]*>Arcade</s', $this->render('index'));
        $this->container['gameRegistry']->setEnabled('arcade', false);
        $this->assertMatchesRegularExpression('/class="lp-hero".*?<h1[^>]*>Doomish</s', $this->render('index'));
    }

    // Kills: a hero that ignores mostPlayedSlugsSince() and always shows the first original.
    public function testHeroIsMostPlayedThisWeek(): void
    {
        $this->games(array_reverse($this->container['lanpartyGames']));
        $this->assertMatchesRegularExpression('/class="lp-hero".*?<h1[^>]*>Saltroad</s', $this->render('index'));
        $game = $this->container['gameRegistry']->get('arcade');
        (new ScoreModel($this->container))->submit($game, 2, 5, null, null, null);
        $this->assertMatchesRegularExpression('/class="lp-hero".*?<h1[^>]*>Arcade</s', $this->render('index'));
    }

    // Kills: a badge that prints "1–1P"/"2–2P" when min == max, or a hyphen instead of the en dash.
    public function testPlayersBadge(): void
    {
        $this->withEngine();
        $html = $this->render('index');
        $this->assertStringContainsString('>1P<', $html);
        $this->assertStringContainsString('>1–4P<', $html);

        $game = $this->container['gameRegistry']->get('arcade');
        $game['players'] = ['min' => 2, 'max' => 2];
        $card = $this->container['template']->render('LanParty:launcher/card', ['game' => $game, 'best' => null]);
        $this->assertStringContainsString('>2P<', $card);
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

    // Kills: a scored game page without a run token for this player and game, or one on a game without scores.
    public function testPlayButtonCarriesARunTokenForScoredGames(): void
    {
        $html = $this->render('game', ['slug' => 'arcade']);
        $run = $this->playAttr($html, 'run');
        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/D', (string) $run);
        $row = $this->container['db']->table('lanparty_runs')->eq('token_hash', hash('sha256', $run))->findOne();
        $this->assertSame(2, (int) $row['user_id']);
        $this->assertSame('arcade', $row['game_slug']);

        $this->assertNull($this->playAttr($this->render('game', ['slug' => 'saltroad']), 'run'));
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

    /** Play button data-lp-* attribute => decoded value, or null when absent. */
    private function playAttr(string $html, string $name): ?string
    {
        return preg_match('/<button[^>]*class="lp-button lp-play"[^>]*\sdata-lp-'.$name.'="([^"]*)"/s', $html, $m)
            ? html_entity_decode($m[1], ENT_QUOTES)
            : null;
    }

    // Kills: a banner shown for an unknown user, for a user without a best score (?from=N reading arbitrary
    // names), without level or seed, or for a level/seed outside the score regexes.
    public function testChallengeBanner(): void
    {
        $game = $this->container['gameRegistry']->get('arcade');
        foreach (['l-1.x_', '1', str_repeat('a', 32)] as $i => $level) {
            (new ScoreModel($this->container))->submit($game, 2, 640, $level, null, null, 1000 + $i * 10);
        }
        $html = $this->render('game', ['slug' => 'arcade', 'level' => 'l-1.x_', 'seed' => 's1', 'from' => '2']);
        $this->assertStringContainsString('Beat Amy’s best: 640', $html);
        $this->assertStringContainsString('l-1.x_', $html);
        $this->assertCspSafe($html);

        $none = [
            'no level/seed' => ['from' => '2'],
            'no seed' => ['level' => '1', 'from' => '2'],
            'markup level' => ['level' => '<i>x</i>', 'seed' => 's1', 'from' => '2'],
            'long level' => ['level' => str_repeat('a', 33), 'seed' => 's1', 'from' => '2'],
            'long seed' => ['level' => '1', 'seed' => str_repeat('a', 65), 'from' => '2'],
            'bad seed' => ['level' => '1', 'seed' => 'a b', 'from' => '2'],
        ];
        foreach ($none as $why => $get) {
            $out = $this->render('game', ['slug' => 'arcade'] + $get);
            $this->assertStringNotContainsString('Beat ', $out, $why);
            $this->assertNull($this->playAttr($out, 'level'), $why);
        }
        $this->assertStringContainsString('Beat Amy’s best: 640', $this->render('game', ['slug' => 'arcade', 'level' => str_repeat('a', 32), 'seed' => str_repeat('b', 64), 'from' => '2']));

        // A real user with no best for this game (admin, id 1) gives no banner: names are only shown off the board.
        $this->assertStringNotContainsString('Beat ', $this->render('game', ['slug' => 'arcade', 'level' => '1', 'seed' => 's', 'from' => '1']));
        // An unscored game never has a best, so never a banner.
        $this->assertStringNotContainsString('Beat ', $this->render('game', ['slug' => 'saltroad', 'level' => '1', 'seed' => 's', 'from' => '2']));
    }

    // Kills: a banner quoting the sharer's best on another level (a level-1 900 on a level-5 challenge), or a
    // banner for a level the sharer never scored on.
    public function testChallengeBannerQuotesTheChallengedLevel(): void
    {
        $game = $this->container['gameRegistry']->get('arcade');
        $scores = new ScoreModel($this->container);
        $scores->submit($game, 2, 900, '1', null, null, 1000);
        $scores->submit($game, 2, 500, '5', null, null, 1010);
        $this->assertStringContainsString('Beat Amy’s best: 500', $this->render('game', ['slug' => 'arcade', 'level' => '5', 'seed' => 's', 'from' => '2']));
        // No best on the challenged level (or an unknown sharer): no banner, but the run still starts on the
        // shared level and seed, so the link is not silently downgraded to a plain game.
        foreach (['no best on level 7' => ['level' => '7', 'seed' => 's', 'from' => '2'], 'unknown user' => ['level' => '7', 'seed' => 's', 'from' => '99']] as $why => $get) {
            $html = $this->render('game', ['slug' => 'arcade'] + $get);
            $this->assertStringNotContainsString('Beat ', $html, $why);
            $this->assertSame('7', $this->playAttr($html, 'level'), $why);
            $this->assertSame('s', $this->playAttr($html, 'seed'), $why);
        }
    }

    // Kills: dropping or mis-building any host attribute (base, game, player, share), or emitting level/seed
    // without a valid challenge.
    public function testPlayButtonHostAttributes(): void
    {
        $this->withEngine();
        $html = $this->render('game', ['slug' => 'doomish']);
        $this->assertSame('/plugins/engines/Games/doomish/', $this->playAttr($html, 'base'));
        $this->assertSame(['slug' => 'doomish', 'title' => 'Doomish', 'version' => '0.1.0'], json_decode($this->playAttr($html, 'game'), true));
        $this->assertSame(['id' => 2, 'name' => 'Amy', 'avatar_url' => null], json_decode($this->playAttr($html, 'player'), true));
        // No application_url: a relative link the host resolves on the page's own origin, never http://localhost/.
        $this->assertSame('/?controller=LauncherController&action=game&plugin=LanParty&slug=doomish', $this->playAttr($html, 'share'));
        $this->assertNull($this->playAttr($html, 'level'));
        $this->assertNull($this->playAttr($html, 'seed'));


        $game = $this->container['gameRegistry']->get('arcade');
        (new ScoreModel($this->container))->submit($game, 2, 640, 'l2', null, null);
        $html = $this->render('game', ['slug' => 'arcade', 'level' => 'l2', 'seed' => 'abc', 'from' => '2']);
        $this->assertSame('l2', $this->playAttr($html, 'level'));
        $this->assertSame('abc', $this->playAttr($html, 'seed'));
    }

    // Kills: a share URL built from the request host when config application_url is set.
    public function testShareUrlUsesApplicationUrl(): void
    {
        $this->container['configModel']->save(['application_url' => 'https://kb.example.test/']);
        $this->assertSame(
            'https://kb.example.test/?controller=LauncherController&action=game&plugin=LanParty&slug=arcade',
            $this->playAttr($this->render('game', ['slug' => 'arcade']), 'share')
        );
    }

    // Kills: injecting lanparty-host.js sitewide, or not at all on launcher pages.
    public function testHostJsOnlyOnLauncherPages(): void
    {
        $js = 'plugins/LanParty/Assets/js/lanparty-host.js';
        $this->assertStringNotContainsString($js, $this->container['helper']->hook->asset('js', 'template:layout:js'));
        $this->assertStringContainsString($js, $this->render('index'));
        $this->assertStringContainsString($js, $this->render('game', ['slug' => 'arcade']));
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
