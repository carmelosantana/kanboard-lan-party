<?php
namespace Kanboard\Plugin\LanParty\Model;

use Kanboard\Core\Base;

/**
 * Single-use run tokens. The game page embeds one (like its CSRF token) and every accepted score hands back the
 * next, so a score can only follow a page the player opened. Scores stay client-reported: this stops blind POSTs
 * and, with the manifest's optional scoring.min_seconds, instant ones; it is not anti-cheat.
 */
class RunModel extends Base
{
    public const TABLE = 'lanparty_runs';
    public const TTL = 86400;

    /**
     * A new token for this player and game. It replaces the player's unused token for that game (one row per player
     * and game, held by a unique index), so reloading the page cannot grow the table; their expired tokens for other
     * games are pruned on the way. Runs in the caller's transaction when one is open, else in its own.
     */
    public function issue(int $userId, string $slug, ?int $now = null): string
    {
        $now ??= time();
        $token = bin2hex(random_bytes(16));
        $own = ! $this->db->getConnection()->inTransaction();
        if ($own) {
            $this->db->startTransaction();
        }
        $this->db->table(self::TABLE)->eq('user_id', $userId)->lt('issued_at', $now - self::TTL)->remove();
        $this->db->table(self::TABLE)->eq('user_id', $userId)->eq('game_slug', $slug)->remove();
        // On a duplicate key (a concurrent issue for the same player and game) PicoDb rolls back and returns false.
        $inserted = $this->db->table(self::TABLE)->insert([
            'token_hash' => hash('sha256', $token),
            'user_id' => $userId,
            'game_slug' => $slug,
            'issued_at' => $now,
        ]);
        if ($inserted !== true) {
            throw new ScoreRejected('unavailable', 'The run could not be started, reload the game page.');
        }
        if ($own) {
            $this->db->closeTransaction();
        }
        return $token;
    }

    /**
     * Uses up the token for this player and game, or throws: `forbidden` for a missing, unknown, foreign, expired or
     * already used token, `bad_request` for a score sooner than $minSeconds after the token was issued (the token
     * is kept). Call inside the transaction that stores the score, so a rejected score gives the token back.
     */
    public function claim(int $userId, string $slug, mixed $token, int $minSeconds, int $now): void
    {
        if (! is_string($token) || ! preg_match('/^[0-9a-f]{32}$/D', $token)) {
            throw new ScoreRejected('forbidden', 'This run has no valid token: reload the game page.');
        }
        $hash = hash('sha256', $token);
        $row = $this->db->table(self::TABLE)->eq('token_hash', $hash)->findOne();
        if (empty($row) || (int) $row['user_id'] !== $userId || $row['game_slug'] !== $slug
            || (int) $row['issued_at'] < $now - self::TTL) {
            throw new ScoreRejected('forbidden', 'This run has no valid token: reload the game page.');
        }
        if ($now - (int) $row['issued_at'] < $minSeconds) {
            throw new ScoreRejected('bad_request', 'That run was too short to score.');
        }
        // The row count, not a re-read, decides: two submits racing on one token cannot both win.
        $stmt = $this->db->getConnection()->prepare('DELETE FROM '.self::TABLE.' WHERE token_hash = ?');
        $stmt->execute([$hash]);
        if ($stmt->rowCount() !== 1) {
            throw new ScoreRejected('forbidden', 'This run has no valid token: reload the game page.');
        }
    }
}
