<?php
namespace Kanboard\Plugin\LanParty;

use Kanboard\Core\Plugin\Base;

class Plugin extends Base
{
    public function initialize(): void
    {
    }

    public function getPluginName(): string        { return 'LanParty'; }
    public function getPluginDescription(): string { return t('A game launcher with leaderboards and rooms for your team.'); }
    public function getPluginAuthor(): string      { return 'Carmelo Santana'; }
    public function getPluginVersion(): string     { return '0.1.0'; }
    public function getPluginHomepage(): string    { return 'https://github.com/carmelosantana/kanboard-lan-party'; }
    public function getCompatibleVersion(): string { return '>=1.2.47'; }
}
