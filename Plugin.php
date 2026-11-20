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
    }

    public function getPluginName(): string        { return 'LanParty'; }
    public function getPluginDescription(): string { return t('A game launcher with leaderboards and rooms for your team.'); }
    public function getPluginAuthor(): string      { return 'Carmelo Santana'; }
    public function getPluginVersion(): string     { return '0.1.0'; }
    public function getPluginHomepage(): string    { return 'https://github.com/carmelosantana/kanboard-lan-party'; }
    public function getCompatibleVersion(): string { return '>=1.2.47'; }
}
