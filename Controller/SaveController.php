<?php
namespace Kanboard\Plugin\LanParty\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\LanParty\Model\SaveModel;
use Kanboard\Plugin\LanParty\Model\ScoreRejected;

// POST lanparty/save (form: slug, data as raw JSON text, csrf_token) and GET lanparty/load/:slug.
// The JSON text is passed through untouched; load answers {"data": "<json text>"} or {"data": null}.
class SaveController extends BaseController
{
    use JsonErrors;

    public function save()
    {
        $this->checkReusableCSRFParam();
        try {
            $game = $this->game($this->request->getRawValue('slug'));
            $data = $this->request->getRawValue('data');
            if (! is_string($data)) {
                throw new ScoreRejected('bad_request', 'Save data must be JSON.');
            }
            (new SaveModel($this->container))->save($this->userSession->getId(), $game['slug'], $data);
        } catch (ScoreRejected $e) {
            return $this->rejected($e);
        }
        $this->response->json(['saved' => true]);
    }

    public function load()
    {
        try {
            $game = $this->game($this->request->getStringParam('slug'));
        } catch (ScoreRejected $e) {
            return $this->rejected($e);
        }
        $this->response->json(['data' => (new SaveModel($this->container))->load($this->userSession->getId(), $game['slug'])]);
    }
}
