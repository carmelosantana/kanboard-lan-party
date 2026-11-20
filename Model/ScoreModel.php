<?php
namespace Kanboard\Plugin\LanParty\Model;

use Kanboard\Core\Base;

// Scores and per-game leaderboards. Portable SQL only (SQLite/MySQL/Postgres): one row per player from SQL, ordered in PHP.
class ScoreModel extends Base
{
    public const TABLE = 'lanparty_scores';
    public const RATE_LIMIT = 5;
    public const WEEK = 7 * 86400;
    public const META_MAX = 1024;
    public const LIMIT_MAX = 100;
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

        $best = $this->best($slug, $userId, $order);
        return ['accepted' => true, 'rank' => $this->rankOf($slug, $order, $userId, $best), 'best' => $best];
    }

    public function leaderboard(array $game, string $period = 'all', int $limit = 10, ?int $now = null): array
    {
        if (empty($game['scoring'])) {
            return [];
        }
        $slug = (string) $game['slug'];
        $since = $period === 'week' ? ($now ?? time()) - self::WEEK : null;
        $limit = max(1, min(self::LIMIT_MAX, $limit));
        $board = array_slice($this->bests($slug, $game['scoring']['order'] ?? 'high', $since), 0, $limit);
        if ($board === []) {
            return [];
        }
        $ids = array_column($board, 'user_id');
        $byUser = array_column($board, null, 'user_id');

        // Level of the row where each listed user first reached their best (oldest id wins an exact repeat).
        $levels = [];
        $rows = $this->db->table(self::TABLE)
            ->columns('user_id', 'score', 'level', 'created_at')
            ->eq('game_slug', $slug)
            ->in('user_id', $ids)
            ->in('created_at', array_values(array_unique(array_column($board, 'date'))))
            ->asc('id')
            ->findAll();
        foreach ($rows as $r) {
            $uid = (int) $r['user_id'];
            if (! array_key_exists($uid, $levels) && (int) $r['score'] === $byUser[$uid]['score'] && (int) $r['created_at'] === $byUser[$uid]['date']) {
                $levels[$uid] = $r['level'];
            }
        }

        $names = [];
        foreach ($this->db->table('users')->columns('id', 'name', 'username')->in('id', $ids)->findAll() as $u) {
            $names[(int) $u['id']] = ($u['name'] ?? '') !== '' ? $u['name'] : $u['username'];
        }

        $out = [];
        foreach ($board as $i => $row) {
            $out[] = [
                'rank' => $i + 1,
                'user_id' => $row['user_id'],
                'name' => $names[$row['user_id']] ?? '',
                'score' => $row['score'],
                'level' => $levels[$row['user_id']] ?? null,
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

    // Agents are left out so they cannot steer the launcher hero.
    public function mostPlayedSince(int $since): ?string
    {
        $players = $this->db->table(self::TABLE)->distinct('user_id')->gte('created_at', $since)->findAllByColumn('user_id');
        $agents = $this->agentFilter->agentIds(array_map('intval', $players));
        $counts = $this->db->table(self::TABLE)
            ->columns('game_slug', 'COUNT(*) AS plays')
            ->gte('created_at', $since)
            ->notIn('user_id', $agents)
            ->groupBy('game_slug')
            ->findAll();
        if ($counts === []) {
            return null;
        }
        usort($counts, fn ($a, $b) => [(int) $b['plays'], $a['game_slug']] <=> [(int) $a['plays'], $b['game_slug']]);
        return $counts[0]['game_slug'];
    }

    /**
     * One row per player: best score and when it was first reached. Portable join, no DB-specific functions.
     * Parameters: slug[, since], slug[, since].
     */
    private function bestsSql(string $order, bool $windowed): string
    {
        $agg = $order === 'low' ? 'MIN' : 'MAX';
        return 'SELECT s.user_id AS user_id, b.best AS best, MIN(s.created_at) AS first_at FROM '.self::TABLE.' s'
            .' JOIN (SELECT user_id, '.$agg.'(score) AS best FROM '.self::TABLE.' WHERE game_slug = ?'
            .($windowed ? ' AND created_at >= ?' : '').' GROUP BY user_id) b ON b.user_id = s.user_id AND b.best = s.score'
            .' WHERE s.game_slug = ?'.($windowed ? ' AND s.created_at >= ?' : '')
            .' GROUP BY s.user_id, b.best';
    }

    /**
     * Ranked players (agents removed): score by order, then the earlier first_at, then user id.
     * @return list<array{user_id:int, score:int, date:int}>
     */
    private function bests(string $slug, string $order, ?int $since): array
    {
        $params = $since === null ? [$slug, $slug] : [$slug, $since, $slug, $since];
        $board = [];
        foreach ($this->select($this->bestsSql($order, $since !== null), $params)->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $board[(int) $r['user_id']] = ['user_id' => (int) $r['user_id'], 'score' => (int) $r['best'], 'date' => (int) $r['first_at']];
        }
        foreach ($this->agentFilter->agentIds(array_keys($board)) as $agentId) {
            unset($board[(int) $agentId]);
        }
        $board = array_values($board);
        $dir = $order === 'low' ? 1 : -1;
        usort($board, fn ($a, $b) => [$dir * ($a['score'] <=> $b['score']), $a['date'], $a['user_id']]
            <=> [0, $b['date'], $b['user_id']]);
        return $board;
    }

    // All-time rank without building the board: 1 + the non-agent players ahead of this one. 0 for an agent.
    private function rankOf(string $slug, string $order, int $userId, ?int $best): int
    {
        if ($best === null || $this->agentFilter->agentIds([$userId]) !== []) {
            return 0;
        }
        $first = (int) $this->db->table(self::TABLE)
            ->eq('game_slug', $slug)->eq('user_id', $userId)->eq('score', $best)
            ->findOneColumn('MIN(created_at) AS first_at');
        $beats = $order === 'low' ? '<' : '>';
        $sql = 'SELECT t.user_id FROM ('.$this->bestsSql($order, false).') t'
            .' WHERE t.best '.$beats.' ? OR (t.best = ? AND (t.first_at < ? OR (t.first_at = ? AND t.user_id < ?)))';
        $ahead = array_map('intval', $this->select($sql, [$slug, $slug, $best, $best, $first, $first, $userId])->fetchAll(\PDO::FETCH_COLUMN, 0));
        return count(array_diff($ahead, $this->agentFilter->agentIds($ahead))) + 1;
    }

    // PicoDb binds everything as a string; SQLite compares an aggregate (no affinity) with text as text, so ints go as ints.
    private function select(string $sql, array $params): \PDOStatement
    {
        $stmt = $this->db->getConnection()->prepare($sql);
        foreach (array_values($params) as $i => $value) {
            $stmt->bindValue($i + 1, $value, is_int($value) ? \PDO::PARAM_INT : \PDO::PARAM_STR);
        }
        $stmt->execute();
        return $stmt;
    }
}
