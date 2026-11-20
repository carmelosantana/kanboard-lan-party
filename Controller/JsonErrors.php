<?php
namespace Kanboard\Plugin\LanParty\Controller;

use Kanboard\Plugin\LanParty\Model\ScoreRejected;

// Shared by the JSON endpoints: one error envelope and one code → HTTP status map.
trait JsonErrors
{
    private static array $statuses = [
        'bad_request' => 400,
        'forbidden' => 403,
        'missing' => 404,
        'too_large' => 413,
        'rate_limited' => 429,
        'unavailable' => 503,
    ];

    private function error(string $code, string $message): void
    {
        $this->response->json(['error' => ['code' => $code, 'message' => $message]], self::$statuses[$code] ?? 400);
    }

    private function rejected(ScoreRejected $e): void
    {
        $this->error($e->code, $e->getMessage());
    }

    /** The enabled game for this slug, or throws `missing` (unknown and disabled games look the same). */
    private function game(mixed $slug): array
    {
        $game = is_string($slug) ? $this->gameRegistry->get($slug) : null;
        if ($game === null) {
            throw new ScoreRejected('missing', 'No such game.');
        }
        return $game;
    }
}
