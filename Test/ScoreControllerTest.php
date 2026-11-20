<?php
require_once 'tests/units/Base.php';
require_once __DIR__.'/EndpointHarness.php';

use KanboardTests\units\Base;
use Kanboard\Core\Controller\AccessForbiddenException;
use Kanboard\Plugin\LanParty\Controller\ScoreController;

// Each test names the ScoreController mutation it kills.
class ScoreControllerTest extends Base
{
    use EndpointHarness;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpEndpoints();
    }

    private function submit(array $post): array
    {
        $this->post($post);
        (new ScoreController($this->container))->submit();
        return $this->captured;
    }

    private function board(array $get): array
    {
        $this->get($get);
        (new ScoreController($this->container))->board();
        return $this->captured;
    }

    private function rows(): int
    {
        return $this->container['db']->table('lanparty_scores')->count();
    }

    // Kills: not casting the form string to int (the model rejects "640"), or dropping rank/best.
    public function testSubmitReturnsRankAndBest(): void
    {
        $out = $this->submit(['slug' => 'arcade', 'score' => '640', 'level' => 'l-2', 'seed' => '', 'meta' => '{"combo":3}']);
        $this->assertSame(200, $out['status']);
        $this->assertSame(['accepted' => true, 'rank' => 1, 'best' => 640], $out['data']);
        $row = $this->container['db']->table('lanparty_scores')->findOne();
        $this->assertSame(2, (int) $row['user_id']);
        $this->assertSame('l-2', $row['level']);
        $this->assertNull($row['seed'], 'an empty seed is stored as null');
        $this->assertSame('{"combo":3}', $row['meta']);
    }

    // Kills: skipping checkReusableCSRFParam on submit.
    public function testSubmitWithoutCsrfIsForbidden(): void
    {
        $this->expectException(AccessForbiddenException::class);
        try {
            $this->submit(['slug' => 'arcade', 'score' => '1', 'csrf_token' => null]);
        } finally {
            $this->assertSame(0, $this->rows());
        }
    }

    // Kills: submitting to a game the registry does not list (unknown or disabled) instead of 404.
    public function testSubmitToUnknownOrDisabledGameIs404(): void
    {
        $this->submit(['slug' => 'nosuch', 'score' => '1']);
        $this->assertError('missing', 404);
        $this->container['gameRegistry']->setEnabled('arcade', false);
        $this->submit(['slug' => 'arcade', 'score' => '1']);
        $this->assertError('missing', 404);
        $this->assertSame(0, $this->rows());
    }

    // Kills: a status map that sends rate_limited as anything but 429.
    public function testSecondQuickSubmitIsRateLimited(): void
    {
        $this->submit(['slug' => 'arcade', 'score' => '10']);
        $this->submit(['slug' => 'arcade', 'score' => '20']);
        $this->assertError('rate_limited', 429);
        $this->assertSame(1, $this->rows());
    }

    // Kills: a lenient cast ((int) "12abc" = 12, (int) "1.5" = 1) instead of the strict digits pattern.
    public function testNonIntegerScoreIsBadRequest(): void
    {
        foreach (['12abc', '1.5', '', ' 7'] as $score) {
            $this->submit(['slug' => 'arcade', 'score' => $score]);
            $this->assertError('bad_request', 400);
        }
        $this->assertSame(0, $this->rows());
    }

    // Kills: ignoring invalid meta JSON (or storing it as a string) instead of 400.
    public function testInvalidMetaIsBadRequest(): void
    {
        $this->submit(['slug' => 'arcade', 'score' => '5', 'meta' => '{nope']);
        $this->assertError('bad_request', 400);
        $this->assertSame(0, $this->rows());
    }

    // Kills: a game without scoring mapped to anything but 503 unavailable.
    public function testUnscoredGameIsUnavailable(): void
    {
        $this->submit(['slug' => 'saltroad', 'score' => '5']);
        $this->assertError('unavailable', 503);
    }

    // Kills: ignoring period=week (old rows leak in) or not wrapping the board in {rows}.
    public function testBoardForWeekReturnsOnlyRecentRows(): void
    {
        (new \Kanboard\Model\UserModel($this->container))->create(['username' => 'bo', 'name' => 'Bo', 'role' => 'app-user']); // 3
        $db = $this->container['db'];
        $db->table('lanparty_scores')->insert(['game_slug' => 'arcade', 'user_id' => 3, 'score' => 900, 'created_at' => time() - 30 * 86400]);
        $db->table('lanparty_scores')->insert(['game_slug' => 'arcade', 'user_id' => 2, 'score' => 300, 'created_at' => time() - 60]);

        $week = $this->board(['slug' => 'arcade', 'period' => 'week']);
        $this->assertSame(200, $week['status']);
        $this->assertSame([2], array_column($week['data']['rows'], 'user_id'));
        $this->assertSame('Amy', $week['data']['rows'][0]['name']);

        $all = $this->board(['slug' => 'arcade']);
        $this->assertSame([3, 2], array_column($all['data']['rows'], 'user_id'));

        $one = $this->board(['slug' => 'arcade', 'limit' => '1']);
        $this->assertSame([3], array_column($one['data']['rows'], 'user_id'), 'limit is passed through');
    }

    // Kills: answering a board for an unknown or disabled game instead of 404.
    public function testBoardForUnknownGameIs404(): void
    {
        $this->board(['slug' => 'nosuch']);
        $this->assertError('missing', 404);
    }
}
