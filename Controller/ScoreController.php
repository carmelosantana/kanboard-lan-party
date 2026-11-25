<?php
namespace Kanboard\Plugin\LanParty\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\LanParty\Model\ScoreModel;
use Kanboard\Plugin\LanParty\Model\ScoreRejected;

// POST lanparty/score (form: slug, score, level, seed, meta JSON, run, csrf_token) and GET lanparty/scores/:slug.
class ScoreController extends BaseController
{
    use JsonErrors;

    public function submit()
    {
        $this->checkReusableCSRFParam();
        try {
            $game = $this->game($this->request->getRawValue('slug'));
            $score = $this->request->getRawValue('score');
            if (is_string($score) && preg_match('/^-?\d{1,18}$/D', $score)) {
                $score = (int) $score;
            }
            $out = (new ScoreModel($this->container))->submitRun(
                $game,
                $this->userSession->getId(),
                $this->request->getRawValue('run'),
                $score,
                $this->optionalString('level'),
                $this->optionalString('seed'),
                $this->meta()
            );
        } catch (ScoreRejected $e) {
            return $this->rejected($e);
        }
        $this->response->json($out);
    }

    public function board()
    {
        try {
            $game = $this->game($this->request->getStringParam('slug'));
        } catch (ScoreRejected $e) {
            return $this->rejected($e);
        }
        $period = $this->request->getStringParam('period') === 'week' ? 'week' : 'all';
        $rows = (new ScoreModel($this->container))->leaderboard($game, $period, $this->request->getIntegerParam('limit', 10));
        $this->response->json(['rows' => $rows]);
    }

    private function optionalString(string $name): ?string
    {
        $value = $this->request->getRawValue($name);
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_string($value)) {
            throw new ScoreRejected('bad_request', 'Invalid '.$name.'.');
        }
        return $value;
    }

    // Objects stay objects (no assoc decode), so {} is stored as {}.
    private function meta(): mixed
    {
        $meta = $this->optionalString('meta');
        if ($meta === null) {
            return null;
        }
        try {
            return json_decode($meta, false, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new ScoreRejected('bad_request', 'Meta must be JSON.');
        }
    }
}
