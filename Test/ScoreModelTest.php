<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Core\Security\Role;
use Kanboard\Model\UserModel;
use Kanboard\Plugin\LanParty\Model\AgentFilter;
use Kanboard\Plugin\LanParty\Model\ScoreModel;
use Kanboard\Plugin\LanParty\Model\ScoreRejected;

// Stands in for Agents' AgentTable: user 3 is an agent.
class LanPartyStubAgentTable
{
    public function __construct($container) {}

    public function agentIds(array $userIds): array
    {
        return array_values(array_intersect($userIds, [3]));
    }
}

// Each test names the ScoreModel mutation it kills.
class ScoreModelTest extends Base
{
    private const NOW = 1_800_000_000;

    protected function setUp(): void
    {
        parent::setUp();
        require_once __DIR__.'/../Schema/Sqlite.php';
        \Kanboard\Plugin\LanParty\Schema\version_1($this->container['db']->getConnection());
        // Hermetic: if Agents is autoloadable but unmigrated, the filter logs and degrades to no agents.
        $this->container['logger'] = $this->createMock(\Psr\Log\LoggerInterface::class);
        $users = new UserModel($this->container);
        $users->create(['username' => 'amy', 'name' => 'Amy', 'role' => Role::APP_USER]);   // 2
        $users->create(['username' => 'bot', 'name' => 'Bot', 'role' => Role::APP_USER]);   // 3
        $users->create(['username' => 'cal', 'role' => Role::APP_USER]);                    // 4, no name
    }

    private function game(string $order = 'high', int $max = 1000, string $slug = 'pop'): array
    {
        return ['slug' => $slug, 'scoring' => ['order' => $order, 'unit' => 'points', 'max' => $max]];
    }

    private function model(string $agentClass = 'Kanboard\\Plugin\\LanParty\\Test\\NoSuchAgentTable'): ScoreModel
    {
        return new ScoreModel($this->container, new AgentFilter($this->container, $agentClass));
    }

    private function row(int $userId, int $score, int $createdAt, string $slug = 'pop', ?string $level = null): void
    {
        $this->container['db']->table('lanparty_scores')->insert([
            'game_slug' => $slug, 'user_id' => $userId, 'score' => $score, 'level' => $level, 'created_at' => $createdAt,
        ]);
    }

    private function rows(): int
    {
        return $this->container['db']->table('lanparty_scores')->count();
    }

    private function rejectCode(callable $fn): string
    {
        try {
            $fn();
        } catch (ScoreRejected $e) {
            return $e->code;
        }
        $this->fail('expected ScoreRejected');
    }

    // Kills: rejecting valid ints, or not writing the row.
    public function testAcceptsAnInRangeInt(): void
    {
        $out = $this->model()->submit($this->game(), 2, 1000, 'lvl-1.a_b', 'seed42', ['combo' => 3], self::NOW);
        $this->assertSame(['accepted' => true, 'rank' => 1, 'best' => 1000], $out);
        $row = $this->container['db']->table('lanparty_scores')->findOne();
        $this->assertSame('pop', $row['game_slug']);
        $this->assertSame('lvl-1.a_b', $row['level']);
        $this->assertSame('seed42', $row['seed']);
        $this->assertSame('{"combo":3}', $row['meta']);
        $this->assertSame(self::NOW, (int) $row['created_at']);
    }

    // Kills: zero treated as invalid (the boundary is 0 <= score).
    public function testAcceptsZero(): void
    {
        $this->assertSame(0, $this->model()->submit($this->game(), 2, 0, null, null, null, self::NOW)['best']);
    }

    // Kills: is_numeric/intval coercion instead of is_int; < vs <= on the bounds.
    public function testRejectsBadScoresAndWritesNothing(): void
    {
        foreach ([1.0, 1.5, '10', -1, 1001, null, true] as $bad) {
            $this->assertSame('bad_request', $this->rejectCode(fn () => $this->model()->submit($this->game(), 2, $bad, null, null, null, self::NOW)), var_export($bad, true));
        }
        $this->assertSame(0, $this->rows());
    }

    // Kills: a missing or loosened level/seed character check.
    public function testRejectsBadLevelAndSeed(): void
    {
        foreach (['a b', '../x', 'é', "a\n", str_repeat('a', 33)] as $bad) {
            $this->assertSame('bad_request', $this->rejectCode(fn () => $this->model()->submit($this->game(), 2, 1, $bad, null, null, self::NOW)), 'level '.$bad);
        }
        foreach (['a b', '<x>', str_repeat('a', 65)] as $bad) {
            $this->assertSame('bad_request', $this->rejectCode(fn () => $this->model()->submit($this->game(), 2, 1, null, $bad, null, self::NOW)), 'seed '.$bad);
        }
        $this->model()->submit($this->game(), 2, 1, str_repeat('a', 32), str_repeat('b', 64), null, self::NOW);
        $this->assertSame(1, $this->rows());
    }

    // Kills: no meta size limit, or an exception other than ScoreRejected for unencodable meta.
    public function testRejectsOversizeOrUnencodableMeta(): void
    {
        $big = ['x' => str_repeat('a', 1024)];
        $this->assertSame('bad_request', $this->rejectCode(fn () => $this->model()->submit($this->game(), 2, 1, null, null, $big, self::NOW)));
        $this->assertSame('bad_request', $this->rejectCode(fn () => $this->model()->submit($this->game(), 2, 1, null, null, ['x' => NAN], self::NOW)));
        $this->assertSame('bad_request', $this->rejectCode(fn () => $this->model()->submit($this->game(), 2, 1, null, null, "\xB1\x31", self::NOW)));
        $this->assertSame(0, $this->rows());
        // 1024 bytes of JSON is the inclusive limit: {"x":"..."} is 8 bytes of wrapper.
        $this->model()->submit($this->game(), 2, 1, null, null, ['x' => str_repeat('a', 1016)], self::NOW);
        $this->assertSame(1, $this->rows());
    }

    // Kills: scoring a game that declares no `scoring`.
    public function testGameWithoutScoringIsUnavailable(): void
    {
        $this->assertSame('unavailable', $this->rejectCode(fn () => $this->model()->submit(['slug' => 'pop'], 2, 1, null, null, null, self::NOW)));
        $this->assertSame(0, $this->rows());
    }

    // Kills: no rate limit, a limit that is not per user+game, or > vs >= at the 5 s edge.
    public function testRateLimitIsFiveSecondsPerUserAndGame(): void
    {
        $m = $this->model();
        $m->submit($this->game(), 2, 1, null, null, null, self::NOW);
        $this->assertSame('rate_limited', $this->rejectCode(fn () => $m->submit($this->game(), 2, 2, null, null, null, self::NOW + 4)));
        $this->assertSame(1, $this->rows());
        $m->submit($this->game('high', 1000, 'other'), 2, 1, null, null, null, self::NOW + 1); // other game: own clock
        $m->submit($this->game(), 4, 1, null, null, null, self::NOW + 1);                       // other user: own clock
        $this->assertTrue($m->submit($this->game(), 2, 2, null, null, null, self::NOW + 5)['accepted']);
    }

    // Kills: summing or using the latest score instead of the best; ignoring `order`.
    public function testLeaderboardBestPerUserHigh(): void
    {
        $this->row(2, 50, self::NOW - 100, 'pop', 'l1');
        $this->row(2, 90, self::NOW - 90, 'pop', 'l2');
        $this->row(2, 10, self::NOW - 80);
        $this->row(4, 70, self::NOW - 70);
        $this->row(4, 99, self::NOW - 60, 'other');
        $board = $this->model()->leaderboard($this->game('high'), 'all', 10, self::NOW);
        $this->assertSame([
            ['rank' => 1, 'user_id' => 2, 'name' => 'Amy', 'score' => 90, 'level' => 'l2', 'date' => self::NOW - 90],
            ['rank' => 2, 'user_id' => 4, 'name' => 'cal', 'score' => 70, 'level' => null, 'date' => self::NOW - 70],
        ], $board);
    }

    // Kills: `low` games ranked by MAX or sorted descending.
    public function testLeaderboardBestPerUserLow(): void
    {
        $this->row(2, 50, self::NOW - 100);
        $this->row(2, 30, self::NOW - 90);
        $this->row(4, 40, self::NOW - 80);
        $this->row(4, 20, self::NOW - 70);
        $board = $this->model()->leaderboard($this->game('low'), 'all', 10, self::NOW);
        $this->assertSame([[4, 20], [2, 30]], array_map(fn ($r) => [$r['user_id'], $r['score']], $board));
    }

    // Kills: ties ordered by user id or by the latest row instead of the earlier created_at of the best.
    public function testTieGoesToEarlierCreatedAt(): void
    {
        $this->row(2, 80, self::NOW - 50);  // amy reaches 80 later...
        $this->row(4, 80, self::NOW - 100); // ...than cal
        $this->row(4, 80, self::NOW - 10);  // cal repeating it later must not cost him the tie
        $board = $this->model()->leaderboard($this->game(), 'all', 10, self::NOW);
        $this->assertSame([4, 2], array_column($board, 'user_id'));
        $this->assertSame(self::NOW - 100, $board[0]['date']);
        $this->assertSame([1, 2], array_column($board, 'rank'));
    }

    // Kills: no week window, or a window that is not 7 days back from $now.
    public function testWeekExcludesEightDayOldRows(): void
    {
        $this->row(2, 900, self::NOW - 8 * 86400);
        $this->row(2, 100, self::NOW - 6 * 86400);
        $this->row(4, 500, self::NOW - 8 * 86400);
        $week = $this->model()->leaderboard($this->game(), 'week', 10, self::NOW);
        $this->assertSame([[2, 100]], array_map(fn ($r) => [$r['user_id'], $r['score']], $week));
        $all = $this->model()->leaderboard($this->game(), 'all', 10, self::NOW);
        $this->assertSame([[2, 900], [4, 500]], array_map(fn ($r) => [$r['user_id'], $r['score']], $all));
    }

    // Kills: ignoring $limit.
    public function testLimit(): void
    {
        $this->row(2, 1, self::NOW);
        $this->row(4, 2, self::NOW);
        $this->assertSame([4], array_column($this->model()->leaderboard($this->game(), 'all', 1, self::NOW), 'user_id'));
    }

    // Kills: not consulting AgentFilter, or failing hard when the Agents class is absent.
    public function testAgentExcludedOnlyWhenAgentsIsPresent(): void
    {
        $this->row(3, 999, self::NOW);
        $this->row(2, 10, self::NOW);
        $with = $this->model(LanPartyStubAgentTable::class)->leaderboard($this->game(), 'all', 10, self::NOW);
        $this->assertSame([2], array_column($with, 'user_id'));
        $this->assertSame(1, $with[0]['rank']);
        $without = $this->model()->leaderboard($this->game(), 'all', 10, self::NOW);
        $this->assertSame([3, 2], array_column($without, 'user_id'));
    }

    // Kills: rank/best computed before the insert, or from the week board.
    public function testSubmitReturnsAllTimeRankAndBestAfterTheSubmit(): void
    {
        $this->row(4, 500, self::NOW - 30 * 86400);
        $this->row(2, 300, self::NOW - 100);
        $m = $this->model();
        $this->assertSame(['accepted' => true, 'rank' => 2, 'best' => 300], $m->submit($this->game(), 2, 200, null, null, null, self::NOW));
        $this->assertSame(['accepted' => true, 'rank' => 1, 'best' => 600], $m->submit($this->game(), 2, 600, null, null, null, self::NOW + 5));
    }

    // Kills: best() ignoring order, slug or user.
    public function testBest(): void
    {
        $this->row(2, 50, self::NOW);
        $this->row(2, 20, self::NOW);
        $this->row(2, 99, self::NOW, 'other');
        $this->row(4, 1, self::NOW);
        $m = $this->model();
        $this->assertSame(50, $m->best('pop', 2, 'high'));
        $this->assertSame(20, $m->best('pop', 2, 'low'));
        $this->assertNull($m->best('nope', 2, 'high'));
    }

    // Kills: playedSlugs leaking other users or repeating slugs; mostPlayedSince ignoring the window.
    public function testPlayedSlugsAndMostPlayedSince(): void
    {
        $this->row(2, 1, self::NOW, 'pop');
        $this->row(2, 1, self::NOW, 'pop');
        $this->row(2, 1, self::NOW, 'gusher');
        $this->row(4, 1, self::NOW, 'saltroad');
        $this->row(4, 1, self::NOW - 10 * 86400, 'saltroad');
        $this->row(4, 1, self::NOW - 10 * 86400, 'saltroad');
        $m = $this->model();
        $slugs = $m->playedSlugs(2);
        sort($slugs);
        $this->assertSame(['gusher', 'pop'], $slugs);
        $this->assertSame('pop', $m->mostPlayedSince(self::NOW - 7 * 86400));
        $this->assertSame('saltroad', $m->mostPlayedSince(0));
        $this->assertNull($m->mostPlayedSince(self::NOW + 1));
    }

    // Kills: a second leaderboard query that returns one row per matching score row instead of one per user,
    // or picking the level of a later repeat instead of the row where the best was first reached.
    public function testRepeatedBestRowsGiveOneRowPerUser(): void
    {
        for ($i = 0; $i < 40; $i++) {
            $this->row(2, 500, self::NOW - 1000 + $i, 'pop', 'r'.$i);
            $this->row(4, 500, self::NOW - 2000 + $i, 'pop', 'c'.$i);
        }
        $board = $this->model()->leaderboard($this->game(), 'all', 10, self::NOW);
        $this->assertSame([[4, 500, 'c0', self::NOW - 2000], [2, 500, 'r0', self::NOW - 1000]],
            array_map(fn ($r) => [$r['user_id'], $r['score'], $r['level'], $r['date']], $board));
    }

    // Kills: an unclamped $limit (0 hides the board, huge values return everyone).
    public function testLimitIsClampedTo1Through100(): void
    {
        $db = $this->container['db'];
        for ($i = 0; $i < 101; $i++) {
            $db->table('users')->insert(['username' => 'p'.$i, 'role' => Role::APP_USER]);
            $this->row((int) $db->getLastId(), $i, self::NOW);
        }
        $this->assertCount(1, $this->model()->leaderboard($this->game(), 'all', 0, self::NOW));
        $this->assertCount(100, $this->model()->leaderboard($this->game(), 'all', 500, self::NOW));
    }

    // Kills: submit()'s rank counting agents ahead, ignoring the tie rule, or ranking an agent submitter.
    public function testSubmitRankSkipsAgentsAndHonoursTies(): void
    {
        $this->row(3, 999, self::NOW - 500); // agent, ahead on score
        $this->row(4, 80, self::NOW - 400);  // reached 80 first
        $m = $this->model(LanPartyStubAgentTable::class);
        $this->assertSame(['accepted' => true, 'rank' => 2, 'best' => 80], $m->submit($this->game(), 2, 80, null, null, null, self::NOW));
        $this->assertSame(['accepted' => true, 'rank' => 0, 'best' => 999], $m->submit($this->game(), 3, 5, null, null, null, self::NOW));
        $low = $this->model(LanPartyStubAgentTable::class);
        $this->assertSame(1, $low->submit($this->game('low', 1000, 'golf'), 2, 3, null, null, null, self::NOW)['rank']);
        $this->row(4, 2, self::NOW - 10, 'golf');
        $this->assertSame(2, $low->submit($this->game('low', 1000, 'golf'), 2, 9, null, null, null, self::NOW + 5)['rank']);
    }

    // Kills: agents steering the launcher hero through mostPlayedSince.
    public function testMostPlayedSinceIgnoresAgents(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->row(3, 1, self::NOW, 'botgame');
        }
        $this->row(2, 1, self::NOW, 'pop');
        $this->assertSame('pop', $this->model(LanPartyStubAgentTable::class)->mostPlayedSince(self::NOW - 10));
        $this->assertSame('botgame', $this->model()->mostPlayedSince(self::NOW - 10));
    }
}
