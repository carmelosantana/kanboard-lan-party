<?php
namespace Kanboard\Plugin\LanParty\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Core\Controller\PageNotFoundException;
use Kanboard\Plugin\LanParty\Model\RunModel;
use Kanboard\Plugin\LanParty\Model\ScoreModel;

// GET lanparty (launcher: hero + rows of cards) and GET lanparty/game/:slug (detail page with Play).
class LauncherController extends BaseController
{
    private const WEEK = 7 * 86400;

    public function index(): void
    {
        $games = $this->gameRegistry->all();
        $scores = new ScoreModel($this->container);
        $userId = $this->userSession->getId();

        $bests = [];
        foreach ($games as $slug => $game) {
            $bests[$slug] = $this->best($scores, $game, $userId);
        }

        $originals = array_filter($games, fn ($g) => $g['kind'] === 'original');
        $rows = array_filter([
            t('Continue playing') => array_intersect_key($games, array_flip($scores->playedSlugs($userId))),
            t('LAN Party Originals') => $originals,
            t('Engine games') => array_filter($games, fn ($g) => $g['kind'] === 'engine'),
        ]);

        // The most-played listed game this week; a disabled or unregistered slug passes to the next one.
        $played = array_values(array_intersect($scores->mostPlayedSlugsSince(time() - self::WEEK), array_keys($games)));
        $hero = $games[$played[0] ?? ''] ?? reset($originals) ?: reset($games) ?: null;

        $this->render('LanParty:launcher/index', [
            'title' => t('LAN Party'),
            'hero' => $hero,
            'rows' => $rows,
            'bests' => $bests,
        ]);
    }

    public function game(): void
    {
        $game = $this->gameRegistry->get($this->request->getStringParam('slug'));
        if ($game === null) {
            throw new PageNotFoundException();
        }
        $scores = new ScoreModel($this->container);
        $slug = $game['slug'];
        $endpoint = fn (string $controller, string $action, array $params = []) =>
            $this->helper->url->to($controller, $action, $params + ['plugin' => 'LanParty']);

        $this->render('LanParty:launcher/game', [
            'title' => $game['title'],
            'game' => $game,
            'board' => [
                t('All time') => $scores->leaderboard($game, 'all'),
                t('This week') => $scores->leaderboard($game, 'week'),
            ],
            'challenge' => $this->challenge($scores, $game),
            'csrf' => $this->token->getReusableCSRFToken(),
            // A scored game's first run token; each accepted score returns the next.
            'run' => isset($game['scoring']) ? (new RunModel($this->container))->issue($this->userSession->getId(), $slug) : null,
            'player' => $this->player(),
            // Absolute on application_url when it is set. Otherwise relative: Kanboard's fallback base is a fixed
            // http://localhost/, so the host resolves the link against the page's own address instead.
            'share' => $this->helper->url->to('LauncherController', 'game', ['plugin' => 'LanParty', 'slug' => $slug], '', $this->configModel->get('application_url') !== ''),
            // url->to(), not href(): href() pre-escapes & as &amp;, and the whole JSON is escaped once in the template.
            'endpoints' => [
                'score' => $endpoint('ScoreController', 'submit'),
                'scores' => $endpoint('ScoreController', 'board', ['slug' => $slug]),
                'save' => $endpoint('SaveController', 'save'),
                'load' => $endpoint('SaveController', 'load', ['slug' => $slug]),
            ],
        ]);
    }

    // The stylesheet and host bridge are attached here, not in Plugin::initialize(), so only launcher pages load them.
    private function render(string $template, array $params): void
    {
        $this->hook->on('template:layout:css', ['template' => 'plugins/LanParty/Assets/css/lanparty.css']);
        $this->hook->on('template:layout:js', ['template' => 'plugins/LanParty/Assets/js/lanparty-host.js']);
        $this->response->html($this->helper->layout->app($template, $params));
    }

    private function best(ScoreModel $scores, array $game, int $userId): ?int
    {
        return isset($game['scoring']) ? $scores->best($game['slug'], $userId, $game['scoring']['order']) : null;
    }

    /** The signed-in player as the SDK's ready() reports it (no avatar in phase 1). */
    private function player(): array
    {
        $user = $this->userSession->getAll();
        return ['id' => (int) $user['id'], 'name' => ($user['name'] ?? '') ?: $user['username'], 'avatar_url' => null];
    }

    /**
     * The shared level and seed when both match the score regexes and `from` is set: the run starts there. Name and
     * best (the sharer's best on that level, not the shared run's score) are filled only when the `from` user has a
     * score on that level, so ?from=N only shows the name of someone who has played it; otherwise they are null and
     * the page shows no banner.
     */
    private function challenge(ScoreModel $scores, array $game): ?array
    {
        $level = $this->request->getStringParam('level');
        $seed = $this->request->getStringParam('seed');
        $from = $this->request->getIntegerParam('from');
        if ($level === '' || $seed === '' || $from <= 0
            || ! preg_match(ScoreModel::LEVEL_RE, $level) || ! preg_match(ScoreModel::SEED_RE, $seed)) {
            return null;
        }
        $challenge = ['name' => null, 'best' => null, 'level' => $level, 'seed' => $seed];
        $best = isset($game['scoring']) ? $scores->best($game['slug'], $from, $game['scoring']['order'], $level) : null;
        $user = $best === null ? null : $this->userModel->getById($from);
        if (! empty($user)) {
            $challenge['name'] = $user['name'] ?: $user['username'];
            $challenge['best'] = $best;
        }
        return $challenge;
    }
}
