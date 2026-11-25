<?php

use Kanboard\Core\Security\Role;
use Kanboard\Model\UserModel;
use Kanboard\Plugin\LanParty\Model\GameRegistry;

// Shared setup for the controller tests: schema, a signed-in player, the scored `arcade` fixture plus the
// unscored `saltroad`, and a mocked Response that records what json() was given (Presence's pattern).
trait EndpointHarness
{
    private array $captured = [];

    private function setUpEndpoints(): void
    {
        require_once __DIR__.'/../Schema/'.ucfirst(DB_DRIVER).'.php'; // the schema for the suite's database
        \Kanboard\Plugin\LanParty\Schema\version_1($this->container['db']->getConnection());
        \Kanboard\Plugin\LanParty\Schema\version_2($this->container['db']->getConnection());
        $this->container['logger'] = $this->createMock(\Psr\Log\LoggerInterface::class);
        (new UserModel($this->container))->create(['username' => 'amy', 'name' => 'Amy', 'role' => Role::APP_USER]); // 2
        $this->container['userSession']->initialize($this->container['userModel']->getById(2));
        $this->container['lanpartyGames'] = [
            ['plugin' => 'scored', 'path' => __DIR__.'/fixtures/games/scored/Games/arcade'],
            ['plugin' => 'good', 'path' => __DIR__.'/fixtures/games/good/Games/saltroad'],
        ];
        $this->container['gameRegistry'] = fn ($c) => new GameRegistry($c, __DIR__.'/fixtures/games');
    }

    /** POST with a valid reusable CSRF token unless the caller overrides or drops it. */
    private function post(array $post): void
    {
        $post += ['csrf_token' => $this->container['token']->getReusableCSRFToken()];
        $this->request(['REQUEST_METHOD' => 'POST'], [], array_filter($post, fn ($v) => $v !== null));
    }

    private function get(array $get): void
    {
        $this->request(['REQUEST_METHOD' => 'GET'], $get, []);
    }

    private function request(array $server, array $get, array $post): void
    {
        $this->container['request'] = new \Kanboard\Core\Http\Request($this->container, $server, $get, $post, [], []);
        $this->captured = [];
        $resp = $this->createMock(\Kanboard\Core\Http\Response::class);
        $resp->method('json')->willReturnCallback(function (array $data, $status = 200) {
            $this->captured = ['data' => $data, 'status' => $status];
        });
        $this->container['response'] = $resp;
    }

    private function assertError(string $code, int $status): void
    {
        $this->assertSame($status, $this->captured['status'] ?? null, json_encode($this->captured));
        $this->assertSame($code, $this->captured['data']['error']['code']);
        $this->assertIsString($this->captured['data']['error']['message']);
    }
}
