<?php
namespace Kanboard\Plugin\LanParty;

use Kanboard\Core\Plugin\Base;
use Kanboard\Plugin\LanParty\Model\GameRegistry;

class Plugin extends Base
{
    public function initialize(): void
    {
        $this->container['gameRegistry'] = function ($c) {
            return new GameRegistry($c);
        };

        $ownGames = array_map(
            fn (string $path) => ['plugin' => 'LanParty', 'path' => $path],
            glob(__DIR__.'/Games/*', GLOB_ONLYDIR) ?: []
        );
        $this->container['lanpartyGames'] = array_merge($this->container['lanpartyGames'] ?? [], $ownGames);

        // Launcher pages (lanparty.css is attached by LauncherController itself, so it loads only there).
        $this->route->addRoute('lanparty', 'LauncherController', 'index', 'LanParty');
        $this->route->addRoute('lanparty/game/:slug', 'LauncherController', 'game', 'LanParty');
        $this->hook->on('template:header:dropdown', ['template' => 'LanParty:header/dropdown']);
        $this->hook->on('template:dashboard:sidebar', ['template' => 'LanParty:dashboard/sidebar']);

        // JSON endpoints for the game bridge (frozen paths).
        $this->route->addRoute('lanparty/score', 'ScoreController', 'submit', 'LanParty');
        $this->route->addRoute('lanparty/scores/:slug', 'ScoreController', 'board', 'LanParty');
        $this->route->addRoute('lanparty/save', 'SaveController', 'save', 'LanParty');
        $this->route->addRoute('lanparty/load/:slug', 'SaveController', 'load', 'LanParty');
    }

    public function getPluginName(): string        { return 'LanParty'; }
    public function getPluginDescription(): string { return t('A game launcher with leaderboards and challenges for your team.'); }
    public function getPluginAuthor(): string      { return 'Carmelo Santana'; }
    public function getPluginVersion(): string     { return '0.1.0'; }
    public function getPluginHomepage(): string    { return 'https://github.com/carmelosantana/kanboard-lan-party'; }
    public function getCompatibleVersion(): string { return '>=1.2.47'; }
}
