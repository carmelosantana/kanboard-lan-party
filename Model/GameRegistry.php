<?php
namespace Kanboard\Plugin\LanParty\Model;

use Kanboard\Core\Base;

/**
 * Reads every folder registered in $container['lanpartyGames'] ([['plugin' => ..., 'path' => ...]]),
 * validates it against the v1 game-module contract and answers which games players may launch.
 */
class GameRegistry extends Base
{
    public const CONFIG_DISABLED = 'lanparty_disabled';
    private const FORBIDDEN_EXTENSIONS = ['php', 'log', 'sqlite'];

    /** @var list<array>|null scan results, in registration order */
    private ?array $scanned = null;

    /** slug ⇒ game (manifest + plugin, base_url, path) for valid, enabled games in registration order. */
    public function all(): array
    {
        $games = [];
        foreach ($this->allForAdmin() as $entry) {
            if ($entry['errors'] === [] && $entry['enabled']) {
                unset($entry['errors'], $entry['enabled']);
                $games[$entry['slug']] = $entry;
            }
        }
        return $games;
    }

    /** Every registered entry, valid or not, each with an `enabled` flag and an `errors` list. */
    public function allForAdmin(): array
    {
        $disabled = $this->disabledSlugs();
        return array_map(
            fn (array $entry) => array_merge($entry, ['enabled' => ! in_array($entry['slug'], $disabled, true)]),
            $this->scan()
        );
    }

    public function get(string $slug): ?array
    {
        return $this->all()[$slug] ?? null;
    }

    public function setEnabled(string $slug, bool $on): void
    {
        if (! preg_match(ManifestValidator::SLUG_PATTERN, $slug)) {
            return;
        }
        $disabled = array_values(array_diff($this->disabledSlugs(), [$slug]));
        if (! $on) {
            $disabled[] = $slug;
        }
        $this->configModel->save([self::CONFIG_DISABLED => implode(',', $disabled)]);
        // ConfigModel::get() memoises getAll() for the request; drop it so the change is visible now.
        $this->memoryCache->remove('proxy:'.get_class($this->configModel).':getAll');
    }

    private function disabledSlugs(): array
    {
        $csv = (string) $this->configModel->get(self::CONFIG_DISABLED, '');
        return array_values(array_filter(array_map('trim', explode(',', $csv)), 'strlen'));
    }

    private function scan(): array
    {
        if ($this->scanned !== null) {
            return $this->scanned;
        }

        $registered = $this->container->offsetExists('lanpartyGames') ? $this->container['lanpartyGames'] : [];
        $seen = [];
        $this->scanned = [];

        foreach (is_array($registered) ? $registered : [] as $registration) {
            $entry = $this->inspect($registration);
            if ($entry['errors'] === []) {
                if (isset($seen[$entry['slug']])) {
                    $entry['errors'] = ['duplicate slug'];
                } else {
                    $seen[$entry['slug']] = true;
                }
            }
            if ($entry['errors'] !== []) {
                $this->logger->info('LanParty: skipping '.$entry['path'].': '.implode('; ', $entry['errors']));
            }
            $this->scanned[] = $entry;
        }

        return $this->scanned;
    }

    private function inspect(mixed $registration): array
    {
        $plugin = is_array($registration) ? ($registration['plugin'] ?? null) : null;
        $path = is_array($registration) ? ($registration['path'] ?? null) : null;
        if (! is_string($plugin) || ! is_string($path)) {
            return ['slug' => '', 'plugin' => '', 'path' => '', 'errors' => ['entry needs plugin and path strings']];
        }

        $path = rtrim($path, '/');
        $parts = explode('/', $path);
        $folder = (string) end($parts);
        $base = ['slug' => $folder, 'plugin' => $plugin, 'path' => $path];

        if (count($parts) < 3 || $parts[count($parts) - 2] !== 'Games') {
            return $base + ['errors' => ['path must be <plugin>/Games/<slug>']];
        }
        if ($parts[count($parts) - 3] !== $plugin) {
            return $base + ['errors' => ['plugin does not match path']];
        }
        // base_url is plugins/<plugin>/Games/<slug>/: a slug folder starting with `data` trips nginx's /data rule.
        if (self::startsWithData($folder)) {
            return $base + ['errors' => ['forbidden path: '.$folder]];
        }
        if (! is_dir($path)) {
            return $base + ['errors' => ['game folder missing']];
        }
        if (! is_file($path.'/game.json')) {
            return $base + ['errors' => ['game.json missing']];
        }

        $manifest = json_decode((string) file_get_contents($path.'/game.json'), true);
        if (! is_array($manifest)) {
            return $base + ['errors' => ['game.json is not valid JSON']];
        }

        $errors = (new ManifestValidator())->validate($manifest);
        if (($manifest['slug'] ?? null) !== $folder) {
            $errors[] = 'slug does not match folder';
        }
        $errors = array_merge($errors, $this->folderErrors($path));

        // Computed keys win over anything the manifest tries to set.
        return array_merge($manifest, [
            'slug' => $folder,
            'plugin' => $plugin,
            'base_url' => 'plugins/'.$plugin.'/Games/'.$folder.'/',
            'path' => $path,
            'errors' => $errors,
        ]);
    }

    /**
     * Kanboard's nginx 404s any URI containing /data, and .php would execute: reject both. Symlinks are
     * rejected outright so nothing can hide behind one.
     */
    private function folderErrors(string $path): array
    {
        $errors = [];
        $files = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );

        try {
            foreach ($files as $file) {
                $relative = substr($file->getPathname(), strlen($path) + 1);
                if ($file->isLink()) {
                    $errors[] = 'forbidden path: '.$relative;
                    continue;
                }
                foreach (explode('/', $relative) as $segment) {
                    if (self::startsWithData($segment)) {
                        $errors[] = 'forbidden path: '.$relative;
                        continue 2;
                    }
                }
                if ($file->isFile() && in_array(strtolower($file->getExtension()), self::FORBIDDEN_EXTENSIONS, true)) {
                    $errors[] = 'forbidden file: '.$relative;
                }
            }
        } catch (\UnexpectedValueException $e) {
            $errors[] = 'folder unreadable';
        }

        sort($errors);
        return $errors;
    }

    private static function startsWithData(string $segment): bool
    {
        return stripos($segment, 'data') === 0;
    }
}
