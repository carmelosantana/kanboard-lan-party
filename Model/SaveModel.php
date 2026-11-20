<?php
namespace Kanboard\Plugin\LanParty\Model;

use Kanboard\Core\Base;
use PicoDb\Database;

// One save per user and game in lanparty_saves (PK user_id, game_slug); a save replaces the row.
// The JSON text is stored and returned verbatim: decoding in PHP would turn {} into [] and {"0":1} into a list.
class SaveModel extends Base
{
    public const TABLE = 'lanparty_saves';
    public const MAX_BYTES = 65536;
    public const SLUG_MAX = 32;

    public function save(int $userId, string $slug, string $json): void
    {
        if ($slug === '' || strlen($slug) > self::SLUG_MAX) {
            throw new ScoreRejected('bad_request', 'Invalid game.');
        }
        if (strlen($json) > self::MAX_BYTES) {
            throw new ScoreRejected('too_large', 'Save data must be at most 64 KB.');
        }
        if (! json_validate($json)) {
            throw new ScoreRejected('bad_request', 'Save data must be JSON.');
        }
        // Portable upsert: delete + insert in one transaction. On a 23000 error (duplicate key from a concurrent
        // save, or a foreign key) PicoDb rolls the transaction back and insert() returns false instead of throwing.
        $saved = $this->db->transaction(function (Database $db) use ($userId, $slug, $json) {
            $db->table(self::TABLE)->eq('user_id', $userId)->eq('game_slug', $slug)->remove();
            return $db->table(self::TABLE)->insert(['user_id' => $userId, 'game_slug' => $slug, 'data' => $json, 'updated_at' => time()]);
        });
        if ($saved !== true) {
            throw new ScoreRejected('unavailable', 'The save could not be stored, try again.');
        }
    }

    public function load(int $userId, string $slug): ?string
    {
        $json = $this->db->table(self::TABLE)->eq('user_id', $userId)->eq('game_slug', $slug)->findOneColumn('data');
        return $json === false || $json === null ? null : (string) $json;
    }
}
