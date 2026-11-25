<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Core\Security\Role;
use Kanboard\Model\UserModel;
use Kanboard\Plugin\LanParty\Model\AgentFilter;
use Kanboard\Plugin\LanParty\Model\RunModel;
use Kanboard\Plugin\LanParty\Model\ScoreModel;
use Kanboard\Plugin\LanParty\Model\ScoreRejected;

// Server-issued run tokens: a score is accepted only with an unused token for that user and game.
// Each test names the RunModel / ScoreModel::submitRun mutation it kills.
class RunTokenTest extends Base
{
    private const NOW = 1_800_000_000;

    protected function setUp(): void
    {
        parent::setUp();
        require_once __DIR__.'/../Schema/'.ucfirst(DB_DRIVER).'.php';
        $pdo = $this->container['db']->getConnection();
        \Kanboard\Plugin\LanParty\Schema\version_1($pdo);
        \Kanboard\Plugin\LanParty\Schema\version_2($pdo);
        $this->container['logger'] = $this->createMock(\Psr\Log\LoggerInterface::class);
        $users = new UserModel($this->container);
        $users->create(['username' => 'amy', 'role' => Role::APP_USER]); // 2
        $users->create(['username' => 'bo', 'role' => Role::APP_USER]);  // 3
    }

    private function game(string $slug = 'pop', ?int $minSeconds = null): array
    {
        $scoring = ['order' => 'high', 'unit' => 'points', 'max' => 1000];
        if ($minSeconds !== null) {
            $scoring['min_seconds'] = $minSeconds;
        }
        return ['slug' => $slug, 'scoring' => $scoring];
    }

    private function scores(): ScoreModel
    {
        return new ScoreModel($this->container, new AgentFilter($this->container, 'Kanboard\\Plugin\\LanParty\\Test\\NoSuchAgentTable'));
    }

    private function runs(): RunModel
    {
        return new RunModel($this->container);
    }

    private function submit(array $game, int $userId, ?string $run, int $score = 500, int $now = self::NOW): array
    {
        return $this->scores()->submitRun($game, $userId, $run, $score, null, null, null, $now);
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

    private function scoreRows(): int
    {
        return $this->container['db']->table(ScoreModel::TABLE)->count();
    }

    // Kills: a guessable or reused token, or storing the token itself instead of its hash.
    public function testIssueReturnsAFreshTokenAndStoresOnlyItsHash(): void
    {
        $a = $this->runs()->issue(2, 'pop', self::NOW);
        $b = $this->runs()->issue(2, 'pop', self::NOW);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/D', $a);
        $this->assertNotSame($a, $b);
        $row = $this->container['db']->table(RunModel::TABLE)->eq('token_hash', hash('sha256', $a))->findOne();
        $this->assertSame(2, (int) $row['user_id']);
        $this->assertSame('pop', $row['game_slug']);
        $this->assertSame(self::NOW, (int) $row['issued_at']);
        $this->assertSame(0, $this->container['db']->table(RunModel::TABLE)->eq('token_hash', $a)->count());
    }

    // Kills: issue() never pruning, so tokens pile up for every page view.
    public function testIssuePrunesTheUsersExpiredTokens(): void
    {
        $this->runs()->issue(2, 'pop', self::NOW - RunModel::TTL - 1);
        $this->runs()->issue(3, 'pop', self::NOW - RunModel::TTL - 1);
        $this->runs()->issue(2, 'pop', self::NOW);
        $this->assertSame(1, $this->container['db']->table(RunModel::TABLE)->eq('user_id', 2)->count());
        $this->assertSame(1, $this->container['db']->table(RunModel::TABLE)->eq('user_id', 3)->count(), 'other users are left alone');
    }

    // Kills: accepting a score with no token or an unknown one (the reproduced finding).
    public function testNoOrUnknownTokenIsForbidden(): void
    {
        $this->assertSame('forbidden', $this->rejectCode(fn () => $this->submit($this->game(), 2, null)));
        $this->assertSame('forbidden', $this->rejectCode(fn () => $this->submit($this->game(), 2, '')));
        $this->assertSame('forbidden', $this->rejectCode(fn () => $this->submit($this->game(), 2, str_repeat('a', 32))));
        $this->assertSame(0, $this->scoreRows());
    }

    // Kills: not binding the token to its user and game.
    public function testTokenForAnotherUserOrGameIsForbidden(): void
    {
        $run = $this->runs()->issue(2, 'pop', self::NOW);
        $this->assertSame('forbidden', $this->rejectCode(fn () => $this->submit($this->game(), 3, $run)));
        $this->assertSame('forbidden', $this->rejectCode(fn () => $this->submit($this->game('other'), 2, $run)));
        $this->assertSame(0, $this->scoreRows());
        $this->assertTrue($this->submit($this->game(), 2, $run)['accepted'], 'a rejected try does not burn the token');
    }

    // Kills: a token that can be replayed, or no next token for the next run.
    public function testTokenIsSingleUseAndTheReplyCarriesTheNext(): void
    {
        $run = $this->runs()->issue(2, 'pop', self::NOW);
        $out = $this->submit($this->game(), 2, $run);
        $this->assertTrue($out['accepted']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/D', $out['run']);
        $this->assertNotSame($run, $out['run']);
        $this->assertSame('forbidden', $this->rejectCode(fn () => $this->submit($this->game(), 2, $run, 600, self::NOW + 10)));
        $this->assertTrue($this->submit($this->game(), 2, $out['run'], 600, self::NOW + 10)['accepted']);
        $this->assertSame(2, $this->scoreRows());
    }

    // Kills: never expiring tokens.
    public function testExpiredTokenIsForbidden(): void
    {
        $run = $this->runs()->issue(2, 'pop', self::NOW - RunModel::TTL - 1);
        $this->assertSame('forbidden', $this->rejectCode(fn () => $this->submit($this->game(), 2, $run)));
    }

    // Kills: ignoring scoring.min_seconds, or burning the token on a too-fast try.
    public function testScoreFasterThanTheGamesMinimumIsRejected(): void
    {
        $game = $this->game('pop', 30);
        $run = $this->runs()->issue(2, 'pop', self::NOW);
        $this->assertSame('bad_request', $this->rejectCode(fn () => $this->submit($game, 2, $run, 500, self::NOW + 29)));
        $this->assertSame(0, $this->scoreRows());
        $this->assertTrue($this->submit($game, 2, $run, 500, self::NOW + 30)['accepted']);
    }

    // Kills: a time floor applied to games whose manifest sets none.
    public function testNoMinimumMeansNoTimeFloor(): void
    {
        $run = $this->runs()->issue(2, 'pop', self::NOW);
        $this->assertTrue($this->submit($this->game(), 2, $run, 500, self::NOW)['accepted']);
    }

    // Kills: consuming the token before the score is validated (a bad score would burn the run).
    public function testInvalidScoreLeavesTheTokenUsable(): void
    {
        $run = $this->runs()->issue(2, 'pop', self::NOW);
        $this->assertSame('bad_request', $this->rejectCode(fn () => $this->submit($this->game(), 2, $run, 5000)));
        $this->assertTrue($this->submit($this->game(), 2, $run, 500)['accepted']);
    }
}
