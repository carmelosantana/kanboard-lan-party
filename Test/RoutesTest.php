<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\LanParty\Plugin;

// Route strings are frozen: the game bridge calls them by path.
class RoutesTest extends Base
{
    // Kills: renaming a frozen route, or wiring it to the wrong controller action.
    public function testJsonEndpointRoutes(): void
    {
        $route = $this->container['route'];
        $route->enable();
        (new Plugin($this->container))->initialize();

        $expected = [
            'lanparty/score' => ['ScoreController', 'submit'],
            'lanparty/scores/arcade' => ['ScoreController', 'board'],
            'lanparty/save' => ['SaveController', 'save'],
            'lanparty/load/arcade' => ['SaveController', 'load'],
        ];
        foreach ($expected as $path => [$controller, $action]) {
            $this->assertSame(['controller' => $controller, 'action' => $action, 'plugin' => 'LanParty'], $route->findRoute($path), $path);
        }
        $this->assertSame('lanparty/scores/arcade', $route->findUrl('ScoreController', 'board', ['slug' => 'arcade'], 'LanParty'));
        $this->assertSame('lanparty/load/arcade', $route->findUrl('SaveController', 'load', ['slug' => 'arcade'], 'LanParty'));
    }
}
