<?php
namespace Kanboard\Plugin\LanParty\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Core\Controller\AccessForbiddenException;
use Kanboard\Plugin\LanParty\Model\ManifestValidator;
use Kanboard\Plugin\LanParty\Model\ScoreModel;

// Settings → LAN Party (admins only, ACL in Plugin.php and checked again here). Scores are client-reported, so an
// admin can remove one player's scores for a game, or reset the game's board.
class ModerationController extends BaseController
{
    public function index(): void
    {
        $this->requireAdmin();
        $scores = new ScoreModel($this->container);
        $games = [];
        foreach ($this->gameRegistry->all() as $slug => $game) {
            if (isset($game['scoring'])) {
                $games[$slug] = $game['title'];
            }
        }
        $this->response->html($this->helper->layout->config('LanParty:config/moderation', [
            'title' => t('Settings').' &gt; '.t('LAN Party'),
            'games' => $games,
            'players' => $scores->players(),
        ]));
    }

    public function remove(): void
    {
        $this->requireAdmin();
        $this->checkCSRFForm();
        $slug = $this->request->getRawValue('game_slug');
        $user = $this->request->getRawValue('user_id');
        $userId = is_string($user) && ctype_digit($user) ? (int) $user : null;
        if (! is_string($slug) || ! preg_match(ManifestValidator::SLUG_PATTERN, $slug)
            || ($user !== null && $user !== '' && $userId === null)) {
            $this->flash->failure(t('Choose a game.'));
        } elseif ($this->request->getRawValue('confirm') !== '1') {
            $this->flash->failure(t('Tick the box to confirm the removal.'));
        } else {
            $count = (new ScoreModel($this->container))->remove($slug, $userId);
            $this->flash->success(t('%d scores removed.', $count));
        }
        $this->response->redirect($this->helper->url->to('ModerationController', 'index', ['plugin' => 'LanParty']));
    }

    private function requireAdmin(): void
    {
        if (! $this->userSession->isAdmin()) {
            throw new AccessForbiddenException();
        }
    }
}
