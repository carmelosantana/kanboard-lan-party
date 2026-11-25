<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\LanParty\Model\ManifestValidator;
use PHPUnit\Framework\Attributes\DataProvider;

// One row per manifest rule; each row names the mutation of ManifestValidator that it kills.
class ManifestValidatorTest extends Base
{
    public static function validManifest(): array
    {
        return [
            'slug' => 'saltroad',
            'title' => 'Saltroad',
            'tagline' => 'Lead a salt caravan to the sea.',
            'version' => '0.1.0',
            'kind' => 'original',
            'licence' => 'MIT',
            'content_licence' => 'CC-BY-4.0',
            'entry' => 'index.html',
            'art' => ['cover' => 'cover.svg', 'hero' => 'hero.svg'],
            'players' => ['min' => 1, 'max' => 1],
            'modes' => ['solo', 'async'],
            'scoring' => ['order' => 'high', 'unit' => 'salt', 'max' => 1000000],
            'files' => [],
        ];
    }

    public function testValidManifestHasNoErrors(): void
    {
        // Kills: any rule that rejects a valid value (e.g. inverted slug regex match).
        $this->assertSame([], (new ManifestValidator())->validate(self::validManifest()));
    }

    public function testOptionalFieldsMayBeAbsent(): void
    {
        // Kills: treating tagline, art.hero, scoring or files as required.
        $m = self::validManifest();
        unset($m['tagline'], $m['art']['hero'], $m['scoring'], $m['files']);
        $this->assertSame([], (new ManifestValidator())->validate($m));
    }

    public function testValidFileSlotAndEngineKindPass(): void
    {
        // Kills: rejecting kind "engine", realtime mode, max 16 players or a well-formed file slot.
        $m = self::validManifest();
        $m['kind'] = 'engine';
        $m['modes'] = ['realtime'];
        $m['players'] = ['min' => 2, 'max' => 16];
        $m['scoring']['order'] = 'low';
        $m['scoring']['min_seconds'] = 30;
        $m['files'] = [['id' => 'doom-wad', 'label' => 'DOOM.WAD', 'accept' => ['.wad', '.WAD'], 'required' => true]];
        $this->assertSame([], (new ManifestValidator())->validate($m));
    }

    public static function brokenRules(): array
    {
        $set = fn (string $path, $value) => function (array $m) use ($path, $value) {
            $ref = &$m;
            foreach (explode('.', $path) as $key) {
                $ref = &$ref[ctype_digit($key) ? (int) $key : $key];
            }
            $ref = $value;
            return $m;
        };
        $unset = fn (string $key) => function (array $m) use ($key) {
            unset($m[$key]);
            return $m;
        };
        $slot = ['id' => 'doom-wad', 'label' => 'DOOM.WAD', 'accept' => ['.wad'], 'required' => true];
        $withSlot = fn (string $key, $value) => function (array $m) use ($slot, $key, $value) {
            $s = $slot;
            if ($value === null) {
                unset($s[$key]);
            } else {
                $s[$key] = $value;
            }
            $m['files'] = [$s];
            return $m;
        };

        return [
            // Kills: dropping the slug required check.
            'slug missing' => ['slug', $unset('slug')],
            // Kills: dropping or loosening the slug regex (uppercase).
            'slug uppercase' => ['slug', $set('slug', 'Saltroad')],
            // Kills: dropping the regex's 2-char minimum.
            'slug too short' => ['slug', $set('slug', 's')],
            // Kills: dropping the regex's 32-char maximum.
            'slug too long' => ['slug', $set('slug', 's'.str_repeat('a', 32))],
            // Kills: dropping the title required check.
            'title missing' => ['title', $unset('title')],
            // Kills: dropping the title length cap.
            'title over 40' => ['title', $set('title', str_repeat('t', 41))],
            // Kills: dropping the version required check.
            'version missing' => ['version', $unset('version')],
            // Kills: dropping the tagline length cap.
            'tagline over 80' => ['tagline', $set('tagline', str_repeat('t', 81))],
            // Kills: dropping the tagline type check.
            'tagline not string' => ['tagline', $set('tagline', 5)],
            // Kills: dropping the kind enum check.
            'kind unknown' => ['kind', $set('kind', 'mod')],
            // Kills: dropping the licence check.
            'licence empty' => ['licence', $set('licence', '')],
            // Kills: dropping the content_licence check.
            'content_licence missing' => ['content_licence', $unset('content_licence')],
            // Kills: dropping the entry required check.
            'entry missing' => ['entry', $unset('entry')],
            // Kills: dropping the `..` segment check.
            'entry dotdot' => ['entry', $set('entry', 'a/../../index.html')],
            // Kills: dropping the leading-slash check.
            'entry absolute' => ['entry', $set('entry', '/index.html')],
            // Kills: dropping the scheme check.
            'entry scheme' => ['entry', $set('entry', 'https://evil.example/x.html')],
            // Kills: dropping the `%` check (browsers decode %2e%2e to ..).
            'entry percent' => ['entry', $set('entry', '%2e%2e/index.html')],
            // Kills: dropping the `?` check.
            'entry query' => ['entry', $set('entry', 'index.html?x=1')],
            // Kills: dropping the `#` check.
            'entry fragment' => ['entry', $set('entry', 'index.html#lp=1')],
            // Kills: refusing a backslash only as the first character (the contract refuses it anywhere).
            'entry backslash' => ['entry', $set('entry', 'game\\index.html')],
            // Kills: the same gap for art.cover.
            'art.cover backslash' => ['art.cover', $set('art.cover', 'art\\cover.svg')],
            // Kills: the same gap for art.hero.
            'art.hero backslash' => ['art.hero', $set('art.hero', 'art\\hero.svg')],
            // Kills: not applying the safe-path rule to art.cover (scheme).
            'art.cover scheme' => ['art.cover', $set('art.cover', 'https://evil.example/c.svg')],
            // Kills: not applying the safe-path rule to art.cover (protocol-relative).
            'art.cover protocol-relative' => ['art.cover', $set('art.cover', '//evil.example/c.svg')],
            // Kills: not applying the safe-path rule to art.cover (data: URI).
            'art.cover data uri' => ['art.cover', $set('art.cover', 'data:image/svg+xml,<svg/>')],
            // Kills: not applying the safe-path rule to art.cover (`..`).
            'art.cover dotdot' => ['art.cover', $set('art.cover', '../other/cover.svg')],
            // Kills: not applying the safe-path rule to art.hero (scheme).
            'art.hero scheme' => ['art.hero', $set('art.hero', 'https://evil.example/h.svg')],
            // Kills: not applying the safe-path rule to art.hero (protocol-relative).
            'art.hero protocol-relative' => ['art.hero', $set('art.hero', '//evil.example/h.svg')],
            // Kills: not applying the safe-path rule to art.hero (data: URI).
            'art.hero data uri' => ['art.hero', $set('art.hero', 'data:image/png;base64,AAAA')],
            // Kills: not applying the safe-path rule to art.hero (`..`).
            'art.hero dotdot' => ['art.hero', $set('art.hero', 'a/../../h.svg')],
            // Kills: dropping the art.cover required check.
            'art.cover missing' => ['art.cover', $set('art', ['hero' => 'hero.svg'])],
            // Kills: dropping the art.hero type check.
            'art.hero not string' => ['art.hero', $set('art.hero', ['x'])],
            // Kills: dropping the players.min integer check.
            'players.min not int' => ['players.min', $set('players.min', '1')],
            // Kills: dropping the min >= 1 bound.
            'players.min zero' => ['players.min', $set('players.min', 0)],
            // Kills: dropping the max <= 16 bound.
            'players.max over 16' => ['players.max', $set('players', ['min' => 1, 'max' => 17])],
            // Kills: dropping the min <= max check.
            'players.max below min' => ['players.max', $set('players', ['min' => 3, 'max' => 2])],
            // Kills: dropping the players.max integer check.
            'players.max missing' => ['players.max', $set('players', ['min' => 1])],
            // Kills: dropping the non-empty modes check.
            'modes empty' => ['modes', $set('modes', [])],
            // Kills: dropping the modes subset check.
            'modes unknown' => ['modes', $set('modes', ['solo', 'coop'])],
            // Kills: dropping the scoring object check.
            'scoring not object' => ['scoring', $set('scoring', 'high')],
            // Kills: dropping the scoring.order enum check.
            'scoring.order unknown' => ['scoring.order', $set('scoring.order', 'best')],
            // Kills: dropping the scoring.unit length cap.
            'scoring.unit over 12' => ['scoring.unit', $set('scoring.unit', str_repeat('u', 13))],
            // Kills: dropping the scoring.max integer check.
            'scoring.max not int' => ['scoring.max', $set('scoring.max', 1.5)],
            // Kills: dropping the scoring.max >= 1 bound.
            'scoring.max zero' => ['scoring.max', $set('scoring.max', 0)],
            // Kills: dropping the scoring.min_seconds integer check.
            'scoring.min_seconds not int' => ['scoring.min_seconds', $set('scoring.min_seconds', '30')],
            // Kills: dropping the scoring.min_seconds lower bound.
            'scoring.min_seconds negative' => ['scoring.min_seconds', $set('scoring.min_seconds', -1)],
            // Kills: dropping the scoring.min_seconds upper bound (a floor past the run token's lifetime).
            'scoring.min_seconds over a day' => ['scoring.min_seconds', $set('scoring.min_seconds', 86401)],
            // Kills: dropping the files list check.
            'files not list' => ['files', $set('files', 'doom.wad')],
            // Kills: dropping the per-slot object check (a string slot).
            'files slot not object' => ['files.0', $set('files', ['x'])],
            // Kills: dropping the slot id regex check.
            'files id bad' => ['files.0.id', $withSlot('id', 'Doom WAD')],
            // Kills: dropping the slot label check.
            'files label missing' => ['files.0.label', $withSlot('label', null)],
            // Kills: dropping the slot accept non-empty check.
            'files accept empty' => ['files.0.accept', $withSlot('accept', [])],
            // Kills: dropping the `.ext` pattern check on accept.
            'files accept no dot' => ['files.0.accept', $withSlot('accept', ['wad'])],
            // Kills: dropping the slot required-bool check.
            'files required not bool' => ['files.0.required', $withSlot('required', 'yes')],
        ];
    }

    /** @dataProvider brokenRules */
    #[DataProvider('brokenRules')]
    public function testEachBrokenRuleIsReportedAgainstItsField(string $field, callable $mutate): void
    {
        $errors = (new ManifestValidator())->validate($mutate(self::validManifest()));

        $this->assertNotEmpty($errors, 'expected an error for '.$field);
        $matching = array_filter($errors, fn (string $e) => str_starts_with($e, $field.': '));
        $this->assertNotEmpty($matching, 'no "'.$field.': …" error in '.json_encode($errors));
    }

    public function testNonObjectSectionsDoNotCrash(): void
    {
        // Kills: indexing art/players without an is_array guard (TypeError on a string).
        $m = self::validManifest();
        $m['art'] = 'cover.svg';
        $m['players'] = 4;
        $errors = (new ManifestValidator())->validate($m);
        $this->assertContains('art.cover: required', $errors);
        $this->assertNotEmpty(array_filter($errors, fn ($e) => str_starts_with($e, 'players.min: ')));
    }
}
