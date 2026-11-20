<?php
namespace Kanboard\Plugin\LanParty\Model;

/**
 * Checks a decoded game.json against the frozen v1 manifest contract.
 * Returns one "<field>: <problem>" string per broken rule; an empty list means valid.
 */
class ManifestValidator
{
    public const SLUG_PATTERN = '/^[a-z][a-z0-9-]{1,31}$/';
    private const KINDS = ['original', 'engine'];
    private const MODES = ['solo', 'async', 'realtime'];
    private const ORDERS = ['high', 'low'];
    private const MAX_PLAYERS = 16;

    public function validate(array $manifest): array
    {
        $errors = [];

        $slug = $manifest['slug'] ?? null;
        if (! is_string($slug) || ! preg_match(self::SLUG_PATTERN, $slug)) {
            $errors[] = 'slug: must match ^[a-z][a-z0-9-]{1,31}$';
        }

        $this->requireString($errors, $manifest, 'title', 40);
        $this->requireString($errors, $manifest, 'version');
        $this->requireString($errors, $manifest, 'licence');
        $this->requireString($errors, $manifest, 'content_licence');

        if (array_key_exists('tagline', $manifest)
            && (! is_string($manifest['tagline']) || mb_strlen($manifest['tagline']) > 80)) {
            $errors[] = 'tagline: must be a string of at most 80 characters';
        }

        if (! in_array($manifest['kind'] ?? null, self::KINDS, true)) {
            $errors[] = 'kind: must be original or engine';
        }

        if ($this->requireString($errors, $manifest, 'entry') && ! self::isSafeRelativePath($manifest['entry'])) {
            $errors[] = 'entry: must be a relative path inside the game folder';
        }

        $this->validateArt($errors, $manifest['art'] ?? null);
        $this->validatePlayers($errors, $manifest['players'] ?? null);
        $this->validateModes($errors, $manifest['modes'] ?? null);

        if (array_key_exists('scoring', $manifest)) {
            $this->validateScoring($errors, $manifest['scoring']);
        }
        if (array_key_exists('files', $manifest)) {
            $this->validateFiles($errors, $manifest['files']);
        }

        return $errors;
    }

    /**
     * Relative, no `..` segment, no leading slash (so no `//host`), and none of `\` (browsers read it as `/`),
     * `:` (scheme, data: URI, drive letter), `%`, `?` or `#` (browsers decode %2e%2e to `..`; query/fragment
     * change the URL) anywhere.
     */
    public static function isSafeRelativePath(string $path): bool
    {
        if ($path === '' || $path[0] === '/' || strpbrk($path, '\\:%?#') !== false) {
            return false;
        }
        return ! in_array('..', explode('/', $path), true);
    }

    private function requireString(array &$errors, array $data, string $field, ?int $max = null, string $prefix = ''): bool
    {
        $value = $data[$field] ?? null;
        if (! is_string($value) || trim($value) === '') {
            $errors[] = $prefix.$field.': required';
            return false;
        }
        if ($max !== null && mb_strlen($value) > $max) {
            $errors[] = $prefix.$field.': must be at most '.$max.' characters';
            return false;
        }
        return true;
    }

    private function validateArt(array &$errors, mixed $art): void
    {
        $art = is_array($art) ? $art : [];
        // Art renders as a same-origin <img src> on the launcher: it must stay inside the game folder.
        if ($this->requireString($errors, $art, 'cover', null, 'art.') && ! self::isSafeRelativePath($art['cover'])) {
            $errors[] = 'art.cover: must be a relative path inside the game folder';
        }
        if (array_key_exists('hero', $art)
            && (! is_string($art['hero']) || trim($art['hero']) === '' || ! self::isSafeRelativePath($art['hero']))) {
            $errors[] = 'art.hero: must be a relative path inside the game folder';
        }
    }

    private function validatePlayers(array &$errors, mixed $players): void
    {
        $players = is_array($players) ? $players : [];
        $min = $players['min'] ?? null;
        $max = $players['max'] ?? null;

        if (! is_int($min) || $min < 1) {
            $errors[] = 'players.min: must be an integer of at least 1';
            $min = null;
        }
        if (! is_int($max) || $max < 1 || $max > self::MAX_PLAYERS) {
            $errors[] = 'players.max: must be an integer from 1 to '.self::MAX_PLAYERS;
        } elseif ($min !== null && $max < $min) {
            $errors[] = 'players.max: must not be below players.min';
        }
    }

    private function validateModes(array &$errors, mixed $modes): void
    {
        if (! is_array($modes) || ! array_is_list($modes) || $modes === []) {
            $errors[] = 'modes: must be a non-empty list';
            return;
        }
        foreach ($modes as $mode) {
            if (! in_array($mode, self::MODES, true)) {
                $errors[] = 'modes: must only contain solo, async or realtime';
                return;
            }
        }
    }

    private function validateScoring(array &$errors, mixed $scoring): void
    {
        if (! is_array($scoring) || array_is_list($scoring)) {
            $errors[] = 'scoring: must be an object';
            return;
        }
        if (! in_array($scoring['order'] ?? null, self::ORDERS, true)) {
            $errors[] = 'scoring.order: must be high or low';
        }
        $this->requireString($errors, $scoring, 'unit', 12, 'scoring.');
        if (! is_int($scoring['max'] ?? null) || $scoring['max'] < 1) {
            $errors[] = 'scoring.max: must be an integer of at least 1';
        }
    }

    private function validateFiles(array &$errors, mixed $files): void
    {
        if (! is_array($files) || ! array_is_list($files)) {
            $errors[] = 'files: must be a list';
            return;
        }
        foreach ($files as $i => $slot) {
            $prefix = 'files.'.$i.'.';
            if (! is_array($slot)) {
                $errors[] = 'files.'.$i.': must be an object';
                continue;
            }
            if (! is_string($slot['id'] ?? null) || ! preg_match(self::SLUG_PATTERN, $slot['id'])) {
                $errors[] = $prefix.'id: must match ^[a-z][a-z0-9-]{1,31}$';
            }
            $this->requireString($errors, $slot, 'label', null, $prefix);
            $accept = $slot['accept'] ?? null;
            if (! is_array($accept) || ! array_is_list($accept) || $accept === []
                || array_filter($accept, fn ($ext) => ! is_string($ext) || ! preg_match('/^\.[A-Za-z0-9]+$/', $ext))) {
                $errors[] = $prefix.'accept: must be a non-empty list of extensions like .wad';
            }
            if (! is_bool($slot['required'] ?? null)) {
                $errors[] = $prefix.'required: must be true or false';
            }
        }
    }
}
