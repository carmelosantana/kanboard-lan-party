<?php
namespace Kanboard\Plugin\LanParty\Model;

use Kanboard\Core\Base;

// One JSON save per user and game, kept in user metadata under lanparty.save.<slug>.
class SaveModel extends Base
{
    public const PREFIX = 'lanparty.save.';
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
        $this->userMetadataModel->save($userId, [self::PREFIX.$slug => $json]);
    }

    public function load(int $userId, string $slug): mixed
    {
        $key = self::PREFIX.$slug;
        if (! $this->userMetadataModel->exists($userId, $key)) {
            return null;
        }
        // MetadataModel::get() returns the default for a falsy value, so a stored "0" comes back as the default "0".
        return json_decode($this->userMetadataModel->get($userId, $key, '0'), true);
    }
}
