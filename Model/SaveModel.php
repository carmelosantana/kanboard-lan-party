<?php
namespace Kanboard\Plugin\LanParty\Model;

use Kanboard\Core\Base;
use PicoDb\Database;

// One JSON save per user and game in lanparty_saves (PK user_id, game_slug); a save replaces the row.
class SaveModel extends Base
{
    public const TABLE = 'lanparty_saves';
    public const MAX_BYTES = 65536;

    public function save(int $userId, string $slug, mixed $data): void
    {
        try {
            $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        } catch (\JsonException $e) {
            throw new ScoreRejected('bad_request', 'Save data must be JSON.');
        }
        if (strlen($json) > self::MAX_BYTES) {
            throw new ScoreRejected('too_large', 'Save data must be at most 64 KB.');
        }
        // Portable upsert: delete + insert in one transaction.
        $this->db->transaction(function (Database $db) use ($userId, $slug, $json) {
            $db->table(self::TABLE)->eq('user_id', $userId)->eq('game_slug', $slug)->remove();
            $db->table(self::TABLE)->insert(['user_id' => $userId, 'game_slug' => $slug, 'data' => $json, 'updated_at' => time()]);
        });
    }

    public function load(int $userId, string $slug): mixed
    {
        $json = $this->db->table(self::TABLE)->eq('user_id', $userId)->eq('game_slug', $slug)->findOneColumn('data');
        return $json === false || $json === null ? null : json_decode($json, true);
    }
}
