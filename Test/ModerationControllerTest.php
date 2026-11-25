<?php
require_once 'tests/units/Base.php';
require_once __DIR__.'/EndpointHarness.php';

use KanboardTests\units\Base;
use Kanboard\Core\Controller\AccessForbiddenException;
use Kanboard\Core\Http\Response;
use Kanboard\Core\Security\Role;
use Kanboard\Model\UserModel;
use Kanboard\Plugin\LanParty\Controller\ModerationController;
use Kanboard\Plugin\LanParty\Model\ScoreModel;
use Kanboard\Plugin\LanParty\Plugin;

// Settings → LAN Party: an admin removes one player's scores for a game, or resets the game's board.
// Each test names the ModerationController / ScoreModel::remove mutation it kills.
class ModerationControllerTest extends Base
{
    use EndpointHarness;

    private string $redirect = '';

    protected function setUp(): void
    {
        parent::setUp();
        (new Plugin($this->container))->initialize();
        $this->setUpEndpoints();
        (new UserModel($this->container))->create(['username' => 'bo', 'name' => 'Bo', 'role' => Role::APP_USER]); // 3
        $this->container['userSession']->initialize($this->container['userModel']->getById(1)); // admin
        $db = $this->container['db'];
        foreach ([[2, 'arcade', 1000], [2, 'arcade', 900], [3, 'arcade', 50], [2, 'pop', 10]] as [$uid, $slug, $score]) {
            $db->table(ScoreModel::TABLE)->insert(['game_slug' => $slug, 'user_id' => $uid, 'score' => $score, 'created_at' => time()]);
        }
    }

    private function scoreCount(string $slug, ?int $userId = null): int
    {
        $q = $this->container['db']->table(ScoreModel::TABLE)->eq('game_slug', $slug);
        if ($userId !== null) {
            $q->eq('user_id', $userId);
        }
        return $q->count();
    }

    private function remove(array $post): void
    {
        $post += ['csrf_token' => $this->container['token']->getCSRFToken(), 'confirm' => '1'];
        $this->container['request'] = new \Kanboard\Core\Http\Request($this->container, ['REQUEST_METHOD' => 'POST'], [], array_filter($post, fn ($v) => $v !== null), [], []);
        $this->redirect = '';
        $resp = $this->createMock(Response::class);
        $resp->method('redirect')->willReturnCallback(function ($url) { $this->redirect = (string) $url; });
        $this->container['response'] = $resp;
        (new ModerationController($this->container))->remove();
    }

    // Kills: routing the page or the action anywhere else.
    public function testRoutes(): void
    {
        $route = $this->container['route'];
        $route->enable();
        (new Plugin($this->container))->initialize();
        $this->assertSame(['controller' => 'ModerationController', 'action' => 'index', 'plugin' => 'LanParty'], $route->findRoute('lanparty/moderation'));
        $this->assertSame(['controller' => 'ModerationController', 'action' => 'remove', 'plugin' => 'LanParty'], $route->findRoute('lanparty/moderation/remove'));
    }

    // Kills: a missing or too-wide ACL entry (any signed-in player could wipe boards).
    public function testOnlyAdminsMayModerate(): void
    {
        $acl = $this->container['applicationAuthorization'];
        foreach (['index', 'remove'] as $action) {
            $this->assertFalse($acl->isAllowed('ModerationController', $action, Role::APP_USER), $action);
            $this->assertFalse($acl->isAllowed('ModerationController', $action, Role::APP_MANAGER), $action);
            $this->assertTrue($acl->isAllowed('ModerationController', $action, Role::APP_ADMIN), $action);
        }
    }

    // Kills: no Settings sidebar entry for the page.
    public function testConfigSidebarLinksThePage(): void
    {
        $html = $this->container['template']->render('LanParty:config/sidebar', []);
        $this->assertStringContainsString('controller=ModerationController&amp;action=index&amp;plugin=LanParty', $html);
        $this->assertContains(['template' => 'LanParty:config/sidebar'], $this->container['hook']->getListeners('template:config:sidebar'));
    }

    // Kills: a page without the CSRF token, the scored games, the players or the confirmation box.
    public function testIndexShowsTheConfirmationForm(): void
    {
        $this->get([]);
        $html = '';
        $resp = $this->createMock(Response::class);
        $resp->method('html')->willReturnCallback(function ($out) use (&$html) { $html = (string) $out; });
        $this->container['response'] = $resp;
        (new ModerationController($this->container))->index();
        $this->assertMatchesRegularExpression('/name="csrf_token" value="[0-9a-f]+"/', $html);
        $this->assertStringContainsString('<option value="arcade">Arcade</option>', $html);
        $this->assertStringNotContainsString('<option value="saltroad">', $html, 'games without scores are not offered');
        $this->assertStringContainsString('<option value="2">Amy</option>', $html);
        $this->assertStringContainsString('<option value="3">Bo</option>', $html);
        $this->assertMatchesRegularExpression('/<input type="checkbox" name="confirm" value="1"[^>]*required/', $html);
    }

    // Kills: removing other players' scores, or other games' scores, along with the chosen player's.
    public function testRemovesOnePlayersScoresForOneGame(): void
    {
        $this->remove(['game_slug' => 'arcade', 'user_id' => '2']);
        $this->assertSame(0, $this->scoreCount('arcade', 2));
        $this->assertSame(1, $this->scoreCount('arcade', 3));
        $this->assertSame(1, $this->scoreCount('pop', 2));
        $this->assertStringContainsString('ModerationController', $this->redirect);
    }

    // Kills: ignoring an empty player (reset) or resetting every game.
    public function testEmptyPlayerResetsTheGamesBoard(): void
    {
        $this->remove(['game_slug' => 'arcade', 'user_id' => '']);
        $this->assertSame(0, $this->scoreCount('arcade'));
        $this->assertSame(1, $this->scoreCount('pop'));
    }

    // Kills: deleting without the confirmation box ticked.
    public function testUnconfirmedRemovalDeletesNothing(): void
    {
        $this->remove(['game_slug' => 'arcade', 'confirm' => null]);
        $this->assertSame(3, $this->scoreCount('arcade'));
    }

    // Kills: skipping the CSRF check on remove.
    public function testRemoveWithoutCsrfIsForbidden(): void
    {
        $this->expectException(AccessForbiddenException::class);
        try {
            $this->remove(['game_slug' => 'arcade', 'csrf_token' => null]);
        } finally {
            $this->assertSame(3, $this->scoreCount('arcade'));
        }
    }

    // Kills: relying on the route ACL alone (the action itself lets a non-admin through).
    public function testNonAdminIsForbiddenEvenWhenRoutedDirectly(): void
    {
        $this->container['userSession']->initialize($this->container['userModel']->getById(2));
        $this->expectException(AccessForbiddenException::class);
        try {
            $this->remove(['game_slug' => 'arcade']);
        } finally {
            $this->assertSame(3, $this->scoreCount('arcade'));
        }
    }

    // Kills: accepting a malformed game slug (the delete would then run on whatever it matches).
    public function testMalformedGameSlugDeletesNothing(): void
    {
        $this->remove(['game_slug' => '']);
        $this->remove(['game_slug' => ['arcade']]);
        $this->assertSame(3, $this->scoreCount('arcade'));
    }
}
