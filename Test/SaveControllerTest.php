<?php
require_once 'tests/units/Base.php';
require_once __DIR__.'/EndpointHarness.php';

use KanboardTests\units\Base;
use Kanboard\Core\Controller\AccessForbiddenException;
use Kanboard\Plugin\LanParty\Controller\SaveController;
use Kanboard\Plugin\LanParty\Model\SaveModel;

// Each test names the SaveController mutation it kills.
class SaveControllerTest extends Base
{
    use EndpointHarness;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpEndpoints();
    }

    private function save(array $post): array
    {
        $this->post($post);
        (new SaveController($this->container))->save();
        return $this->captured;
    }

    private function load(string $slug): array
    {
        $this->get(['slug' => $slug]);
        (new SaveController($this->container))->load();
        return $this->captured;
    }

    // Kills: decoding/re-encoding the save ({} would come back as []), or loading another shape than {data}.
    public function testSaveLoadRoundTrip(): void
    {
        $this->assertSame(['data' => ['data' => null], 'status' => 200], $this->load('saltroad'), 'no save yet');
        foreach (['{}', '{"level":3,"bag":["rope"]}'] as $json) {
            $this->assertSame(['data' => ['saved' => true], 'status' => 200], $this->save(['slug' => 'saltroad', 'data' => $json]));
            $this->assertSame(['data' => ['data' => $json], 'status' => 200], $this->load('saltroad'));
        }
    }

    // Kills: a status map that sends too_large as anything but 413.
    public function testOversizeSaveIs413(): void
    {
        $this->save(['slug' => 'saltroad', 'data' => '"'.str_repeat('a', SaveModel::MAX_BYTES).'"']);
        $this->assertError('too_large', 413);
        $this->assertSame(0, $this->container['db']->table('lanparty_saves')->count());
    }

    // Kills: skipping checkReusableCSRFParam on save.
    public function testSaveWithoutCsrfIsForbidden(): void
    {
        $this->expectException(AccessForbiddenException::class);
        $this->save(['slug' => 'saltroad', 'data' => '{}', 'csrf_token' => 'nope']);
    }

    // Kills: saving or loading for a slug the registry does not list.
    public function testUnknownGameIs404(): void
    {
        $this->save(['slug' => 'nosuch', 'data' => '{}']);
        $this->assertError('missing', 404);
        $this->load('nosuch');
        $this->assertError('missing', 404);
        $this->assertSame(0, $this->container['db']->table('lanparty_saves')->count());
    }

    // Kills: passing a missing or non-JSON data field through as anything but 400.
    public function testBadDataIsBadRequest(): void
    {
        $this->save(['slug' => 'saltroad']);
        $this->assertError('bad_request', 400);
        $this->save(['slug' => 'saltroad', 'data' => '{nope']);
        $this->assertError('bad_request', 400);
    }
}
