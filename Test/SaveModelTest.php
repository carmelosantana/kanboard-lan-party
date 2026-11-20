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
        require_once __DIR__.'/../Schema/'.ucfirst(DB_DRIVER).'.php'; // the schema for the suite's database
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

    private function rows(): int
    {
        return $this->container['db']->table('lanparty_saves')->count();
    }

    // Kills: re-encoding the JSON, keeping a second row on overwrite, or writing user metadata.
    public function testRoundTrip(): void
    {
        $saves = new SaveModel($this->container);
        $json = '{"level":3,"inventory":["rope","lamp"],"name":"Ünïcode\/ok"}';
        $saves->save(2, 'saltroad', $json);
        $this->assertSame($json, $saves->load(2, 'saltroad'));
        $this->assertSame($json, $this->stored(2, 'saltroad')['data']);
        $saves->save(2, 'saltroad', '{"level":4}');
        $this->assertSame('{"level":4}', $saves->load(2, 'saltroad'));
        $this->assertSame(1, $this->rows(), 'upsert replaces the row');
        $this->assertSame([], $this->container['userMetadataModel']->getAll(2), 'user metadata is not used');
    }

    // Kills: a json_decode(..., true) round trip, which turns {} into [] and {"0":1} into a list.
    public function testObjectsRoundTripByteIdentical(): void
    {
        $saves = new SaveModel($this->container);
        foreach (['{}', '{"0":1}', '[]', '0', 'false', '""', 'null', ' { "a" : 1 } '] as $json) {
            $saves->save(2, 'pop', $json);
            $this->assertSame($json, $saves->load(2, 'pop'), $json);
        }
    }

    // Kills: a key that ignores the user or the slug.
    public function testIsolationPerUserAndGame(): void
    {
        $saves = new SaveModel($this->container);
        $saves->save(1, 'pop', '{"who":"admin"}');
        $saves->save(2, 'pop', '{"who":"amy"}');
        $saves->save(2, 'saltroad', '{"who":"amy-salt"}');
        $this->assertSame('{"who":"admin"}', $saves->load(1, 'pop'));
        $this->assertSame('{"who":"amy"}', $saves->load(2, 'pop'));
        $this->assertSame('{"who":"amy-salt"}', $saves->load(2, 'saltroad'));
        $this->assertNull($saves->load(1, 'saltroad'));
    }

    // Kills: an off-by-one at 65 536 bytes, or counting characters instead of bytes.
    public function testSizeLimitIs65536Bytes(): void
    {
        $saves = new SaveModel($this->container);
        $ok = '"'.str_repeat('a', 65536 - 2).'"';
        $saves->save(2, 'pop', $ok);
        $this->assertSame($ok, $saves->load(2, 'pop'));
        $this->assertSame(65536, strlen($this->stored(2, 'pop')['data']), 'the full 64 KB reaches the table');

        $this->assertSame('too_large', $this->rejectCode(fn () => $saves->save(2, 'pop', '"'.str_repeat('a', 65535).'"')));
        // 'é' is one character but two bytes: 65 536 characters, 65 537 bytes.
        $this->assertSame('too_large', $this->rejectCode(fn () => $saves->save(2, 'pop', '"'.str_repeat('a', 65533).'é"')));
        $this->assertSame($ok, $saves->load(2, 'pop'), 'a rejected save leaves the old one');
    }

    // Kills: storing text that is not JSON.
    public function testInvalidJsonIsBadRequest(): void
    {
        $saves = new SaveModel($this->container);
        foreach (['', '{', "{'a':1}", 'NaN', "\"\xB1\x31\""] as $bad) {
            $this->assertSame('bad_request', $this->rejectCode(fn () => $saves->save(2, 'pop', $bad)), var_export($bad, true));
        }
        $this->assertNull($saves->load(2, 'pop'));
    }

    // Kills: an unchecked slug reaching the VARCHAR(32) column (truncation on MySQL, error on Postgres).
    public function testSlugLongerThan32IsBadRequest(): void
    {
        $saves = new SaveModel($this->container);
        $this->assertSame('bad_request', $this->rejectCode(fn () => $saves->save(2, str_repeat('s', 33), '{}')));
        $this->assertSame(0, $this->rows());
        $saves->save(2, str_repeat('s', 32), '{}');
        $this->assertSame(1, $this->rows());
    }

    // Kills: ignoring insert() returning false (PicoDb rolls back and returns false on a 23000 error).
    public function testFailedInsertThrowsAndKeepsNothing(): void
    {
        $saves = new SaveModel($this->container);
        // No user 999: the foreign key makes the insert fail with SQLSTATE 23000, the same path as a duplicate key.
        $this->assertSame('unavailable', $this->rejectCode(fn () => $saves->save(999, 'pop', '{}')));
        $this->assertSame(0, $this->rows());
        // The connection is usable afterwards (no transaction left open).
        $saves->save(2, 'pop', '{}');
        $this->assertSame('{}', $saves->load(2, 'pop'));
    }

    // Kills: a missing ON DELETE CASCADE (SQLite enforces it only with PRAGMA foreign_keys = ON, so check that too).
    public function testDeletingTheUserRemovesTheirSaves(): void
    {
        $saves = new SaveModel($this->container);
        $saves->save(1, 'pop', '{"who":"admin"}');
        $saves->save(2, 'pop', '{"who":"amy"}');
        $saves->save(2, 'saltroad', '{"who":"amy"}');
        if (DB_DRIVER === 'sqlite') {
            $this->assertSame(1, (int) $this->container['db']->getConnection()->query('PRAGMA foreign_keys')->fetchColumn());
        }
        $this->assertTrue((new UserModel($this->container))->remove(2));
        $this->assertSame(0, $this->container['db']->table('lanparty_saves')->eq('user_id', 2)->count());
        $this->assertSame('{"who":"admin"}', $saves->load(1, 'pop'));
    }
}
