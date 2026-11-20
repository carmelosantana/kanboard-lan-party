<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Core\Security\Role;
use Kanboard\Model\UserModel;
use Kanboard\Plugin\LanParty\Model\SaveModel;
use Kanboard\Plugin\LanParty\Model\ScoreRejected;

// Each test names the SaveModel mutation it kills.
class SaveModelTest extends Base
{
    protected function setUp(): void
    {
        parent::setUp();
        require_once __DIR__.'/../Schema/Sqlite.php';
        \Kanboard\Plugin\LanParty\Schema\version_1($this->container['db']->getConnection());
        (new UserModel($this->container))->create(['username' => 'amy', 'role' => Role::APP_USER]); // 2
    }

    private function rejectCode(callable $fn): string
    {
        try {
            $fn();
        } catch (ScoreRejected $e) {
            return $e->code;
        }
        $this->fail('expected ScoreRejected');
    }

    private function stored(int $userId, string $slug): ?array
    {
        return $this->container['db']->table('lanparty_saves')->eq('user_id', $userId)->eq('game_slug', $slug)->findOne();
    }

    // Kills: storing without JSON encoding, keeping a second row on overwrite, or writing user metadata.
    public function testRoundTrip(): void
    {
        $saves = new SaveModel($this->container);
        $data = ['level' => 3, 'inventory' => ['rope', 'lamp'], 'name' => 'Ünïcode/ok'];
        $saves->save(2, 'saltroad', $data);
        $this->assertSame($data, $saves->load(2, 'saltroad'));
        $this->assertSame($data, json_decode($this->stored(2, 'saltroad')['data'], true));
        $saves->save(2, 'saltroad', ['level' => 4]);
        $this->assertSame(['level' => 4], $saves->load(2, 'saltroad'));
        $this->assertSame(1, $this->container['db']->table('lanparty_saves')->count(), 'upsert replaces the row');
        $this->assertSame([], $this->container['userMetadataModel']->getAll(2), 'user metadata is not used');
    }

    // Kills: load() returning null for a falsy save (MetadataModel::get treats "0" as missing).
    public function testFalsySavesSurvive(): void
    {
        $saves = new SaveModel($this->container);
        foreach ([0, false, '', []] as $value) {
            $saves->save(2, 'pop', $value);
            $this->assertSame($value, $saves->load(2, 'pop'), var_export($value, true));
        }
    }

    // Kills: a key that ignores the user or the slug.
    public function testIsolationPerUserAndGame(): void
    {
        $saves = new SaveModel($this->container);
        $saves->save(1, 'pop', ['who' => 'admin']);
        $saves->save(2, 'pop', ['who' => 'amy']);
        $saves->save(2, 'saltroad', ['who' => 'amy-salt']);
        $this->assertSame(['who' => 'admin'], $saves->load(1, 'pop'));
        $this->assertSame(['who' => 'amy'], $saves->load(2, 'pop'));
        $this->assertSame(['who' => 'amy-salt'], $saves->load(2, 'saltroad'));
        $this->assertNull($saves->load(1, 'saltroad'));
    }

    // Kills: an off-by-one at 65 536 bytes, or counting characters instead of JSON bytes.
    public function testSizeLimitIs65536BytesOfJson(): void
    {
        $saves = new SaveModel($this->container);
        $ok = str_repeat('a', 65536 - 2); // "..." adds two quote bytes
        $saves->save(2, 'pop', $ok);
        $this->assertSame($ok, $saves->load(2, 'pop'));
        $this->assertSame(65536, strlen($this->stored(2, 'pop')['data']), 'the full 64 KB reaches the table');

        $this->assertSame('too_large', $this->rejectCode(fn () => $saves->save(2, 'pop', $ok.'a')));
        // 'é' is one character but two bytes of JSON (unescaped UTF-8).
        $this->assertSame('too_large', $this->rejectCode(fn () => $saves->save(2, 'pop', str_repeat('a', 65533).'é')));
        $this->assertSame($ok, $saves->load(2, 'pop'), 'a rejected save leaves the old one');
    }

    // Kills: letting json_encode failures through as false/"null" or a non-ScoreRejected error.
    public function testUnencodableIsBadRequest(): void
    {
        $saves = new SaveModel($this->container);
        $this->assertSame('bad_request', $this->rejectCode(fn () => $saves->save(2, 'pop', ['x' => NAN])));
        $this->assertSame('bad_request', $this->rejectCode(fn () => $saves->save(2, 'pop', "\xB1\x31")));
        $this->assertNull($saves->load(2, 'pop'));
    }

    // Kills: a missing ON DELETE CASCADE (the SQLite test DB runs with PRAGMA foreign_keys = ON).
    public function testDeletingTheUserRemovesTheirSaves(): void
    {
        $saves = new SaveModel($this->container);
        $saves->save(1, 'pop', ['who' => 'admin']);
        $saves->save(2, 'pop', ['who' => 'amy']);
        $saves->save(2, 'saltroad', ['who' => 'amy']);
        $this->assertSame(1, (int) $this->container['db']->getConnection()->query('PRAGMA foreign_keys')->fetchColumn());
        $this->assertTrue((new UserModel($this->container))->remove(2));
        $this->assertSame(0, $this->container['db']->table('lanparty_saves')->eq('user_id', 2)->count());
        $this->assertSame(['who' => 'admin'], $saves->load(1, 'pop'));
    }
}
