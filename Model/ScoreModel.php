<?php
namespace Kanboard\Plugin\LanParty\Model;

use Kanboard\Core\Base;

// Scores and per-game leaderboards. Portable SQL only (SQLite/MySQL/Postgres); ranking is done in PHP.
class ScoreModel extends Base
{
    public const TABLE = 'lanparty_scores';
    public const RATE_LIMIT = 5;
    public const WEEK = 7 * 86400;
    public const META_MAX = 1024;
    // Level fits VARCHAR(32), seed VARCHAR(64); both use the spec's character set.
    private const LEVEL_RE = '/^[A-Za-z0-9_.-]{0,32}$/D';
    private const SEED_RE = '/^[A-Za-z0-9_.-]{0,64}$/D';

    private AgentFilter $agentFilter;

    public function __construct($container, ?AgentFilter $agentFilter = null)
    {
        parent::__construct($container);
        $this->agentFilter = $agentFilter ?? new AgentFilter($container);
    }

    public function submit(array $game, int $userId, mixed $score, ?string $level, ?string $seed, mixed $meta, ?int $now = null): array
    {
        $now ??= time();
        if (empty($game['scoring'])) {
            throw new ScoreRejected('unavailable', 'This game does not keep scores.');
        }
        $slug = (string) $game['slug'];
        $max = (int) $game['scoring']['max'];
        $order = $game['scoring']['order'] ?? 'high';

        if (! is_int($score) || $score < 0 || $score > $max) {
            throw new ScoreRejected('bad_request', 'Score must be a whole number from 0 to '.$max.'.');
        }
        if ($level !== null && ! preg_match(self::LEVEL_RE, $level)) {
            throw new ScoreRejected('bad_request', 'Invalid level.');
        }
        if ($seed !== null && ! preg_match(self::SEED_RE, $seed)) {
            throw new ScoreRejected('bad_request', 'Invalid seed.');
        }
        $metaJson = null;
        if ($meta !== null) {
            try {
                $metaJson = json_encode($meta, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            } catch (\JsonException $e) {
                throw new ScoreRejected('bad_request', 'Meta must be JSON.');
            }
            if (strlen($metaJson) > self::META_MAX) {
                throw new ScoreRejected('bad_request', 'Meta must be at most 1 KB.');
            }
        }

        $last = $this->db->table(self::TABLE)
            ->eq('user_id', $userId)
            ->eq('game_slug', $slug)
            ->findOneColumn('MAX(created_at) AS last_at');
        if ($last !== null && $last !== false && $now - (int) $last < self::RATE_LIMIT) {
            throw new ScoreRejected('rate_limited', 'Slow down: one score every '.self::RATE_LIMIT.' seconds.');
        }

        $this->db->table(self::TABLE)->insert([
            'game_slug' => $slug,
            'user_id' => $userId,
            'score' => $score,
            'level' => $level === '' ? null : $level,
            'seed' => $seed === '' ? null : $seed,
            'meta' => $metaJson,
            'created_at' => $now,
        ]);

        $rank = 0; // stays 0 for a user kept off the board (an agent)
        foreach ($this->board($slug, $order, null) as $i => $row) {
            if ($row['user_id'] === $userId) {
                $rank = $i + 1;
                break;
            }
        }

        return ['accepted' => true, 'rank' => $rank, 'best' => $this->best($slug, $userId, $order)];
    }

    public function leaderboard(array $game, string $period = 'all', int $limit = 10, ?int $now = null): array
    {
        if (empty($game['scoring'])) {
            return [];
        }
        $since = $period === 'week' ? ($now ?? time()) - self::WEEK : null;
        $board = array_slice($this->board((string) $game['slug'], $game['scoring']['order'] ?? 'high', $since), 0, max(0, $limit));
        if ($board === []) {
            return [];
        }

        $users = [];
        foreach ($this->db->table('users')->columns('id', 'name', 'username')->in('id', array_column($board, 'user_id'))->findAll() as $u) {
            $users[(int) $u['id']] = ($u['name'] ?? '') !== '' ? $u['name'] : $u['username'];
        }

        $out = [];
        foreach ($board as $i => $row) {
            $out[] = [
                'rank' => $i + 1,
                'user_id' => $row['user_id'],
                'name' => $users[$row['user_id']] ?? '',
                'score' => $row['score'],
                'level' => $row['level'],
                'date' => $row['date'],
            ];
        }
        return $out;
    }

    public function best(string $slug, int $userId, string $order): ?int
    {
        $best = $this->db->table(self::TABLE)
            ->eq('game_slug', $slug)
            ->eq('user_id', $userId)
            ->findOneColumn(($order === 'low' ? 'MIN' : 'MAX').'(score) AS best');
        return $best === null || $best === false ? null : (int) $best;
    }

    public function playedSlugs(int $userId): array
    {
        return array_values(array_unique($this->db->table(self::TABLE)->eq('user_id', $userId)->findAllByColumn('game_slug')));
    }

    public function mostPlayedSince(int $since): ?string
    {
        $counts = $this->db->table(self::TABLE)
            ->columns('game_slug', 'COUNT(*) AS plays')
            ->gte('created_at', $since)
            ->groupBy('game_slug')
            ->findAll();
        if ($counts === []) {
            return null;
        }
        usort($counts, fn ($a, $b) => [(int) $b['plays'], $a['game_slug']] <=> [(int) $a['plays'], $b['game_slug']]);
        return $counts[0]['game_slug'];
    }

    /**
     * Best row per user, sorted: score (by order), then the earlier time that best was first reached, then user id.
     * @return list<array{user_id:int, score:int, level:?string, date:int}>
     */
    private function board(string $slug, string $order, ?int $since): array
    {
        $agg = $order === 'low' ? 'MIN' : 'MAX';
        $query = $this->db->table(self::TABLE)->columns('user_id', $agg.'(score) AS best')->eq('game_slug', $slug);
        if ($since !== null) {
            $query->gte('created_at', $since);
        }
        $bests = [];
        foreach ($query->groupBy('user_id')->findAll() as $r) {
            $bests[(int) $r['user_id']] = (int) $r['best'];
        }
        foreach ($this->agentFilter->agentIds(array_keys($bests)) as $agentId) {
            unset($bests[(int) $agentId]);
        }
        if ($bests === []) {
            return [];
        }

        // Rows that hit some user's best, oldest first: the first match per user is when they reached it.
        $query = $this->db->table(self::TABLE)
            ->columns('user_id', 'score', 'level', 'created_at')
            ->eq('game_slug', $slug)
            ->in('user_id', array_keys($bests))
            ->in('score', array_values(array_unique($bests)));
        if ($since !== null) {
            $query->gte('created_at', $since);
        }
        $board = [];
        foreach ($query->asc('created_at')->asc('id')->findAll() as $r) {
            $uid = (int) $r['user_id'];
            if (! isset($board[$uid]) && (int) $r['score'] === $bests[$uid]) {
                $board[$uid] = ['user_id' => $uid, 'score' => (int) $r['score'], 'level' => $r['level'], 'date' => (int) $r['created_at']];
            }
        }

        $board = array_values($board);
        $dir = $order === 'low' ? 1 : -1;
        usort($board, fn ($a, $b) => [$dir * ($a['score'] <=> $b['score']), $a['date'], $a['user_id']]
            <=> [0, $b['date'], $b['user_id']]);
        return $board;
    }
}
