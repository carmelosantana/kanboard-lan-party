<div class="lp-launcher lp-game">
    <section class="lp-hero">
        <img class="lp-hero-art" src="<?= $this->text->e($this->url->dir().$game['base_url'].($game['art']['hero'] ?? $game['art']['cover'])) ?>" alt="">
        <div class="lp-hero-body">
            <?php if ($challenge !== null && $challenge['best'] !== null): ?>
                <p class="lp-challenge">
                    <?= t('Beat %s’s best: %s', $challenge['name'], $challenge['best']) ?>
                    <span class="lp-challenge-meta"><?= t('Level') ?> <?= $this->text->e($challenge['level']) ?> · <?= t('Seed') ?> <?= $this->text->e($challenge['seed']) ?></span>
                </p>
            <?php endif ?>
            <h1 class="lp-hero-title"><?= $this->text->e($game['title']) ?></h1>
            <?php if (! empty($game['tagline'])): ?>
                <p class="lp-tagline"><?= $this->text->e($game['tagline']) ?></p>
            <?php endif ?>
            <button type="button" class="lp-button lp-play"
                data-lp-slug="<?= $this->text->e($game['slug']) ?>"
                data-lp-src="<?= $this->text->e($this->url->dir().$game['base_url'].$game['entry']) ?>"
                data-lp-csrf="<?= $this->text->e($csrf) ?>"
                data-lp-endpoints="<?= $this->text->e(json_encode($endpoints, JSON_UNESCAPED_SLASHES)) ?>"
                data-lp-base="<?= $this->text->e($this->url->dir().$game['base_url']) ?>"
                data-lp-game="<?= $this->text->e(json_encode(['slug' => $game['slug'], 'title' => $game['title'], 'version' => $game['version']], JSON_UNESCAPED_SLASHES)) ?>"
                data-lp-player="<?= $this->text->e(json_encode($player, JSON_UNESCAPED_SLASHES)) ?>"
                data-lp-share="<?= $this->text->e($share) ?>"
                <?php if ($challenge !== null): ?>data-lp-level="<?= $this->text->e($challenge['level']) ?>" data-lp-seed="<?= $this->text->e($challenge['seed']) ?>"<?php endif ?>><?= t('Play') ?></button>
            <p class="lp-licences">
                <?= t('Code licence') ?>: <?= $this->text->e($game['licence']) ?> ·
                <?= t('Content licence') ?>: <?= $this->text->e($game['content_licence']) ?>
            </p>
        </div>
    </section>
    <section class="lp-boards">
        <?php foreach ($board as $label => $rows): ?>
            <div class="lp-board">
                <h2 class="lp-row-title"><?= $this->text->e($label) ?></h2>
                <?php if ($rows === []): ?>
                    <p class="lp-muted"><?= t('No scores yet') ?></p>
                <?php else: ?>
                    <table class="lp-board-table">
                        <?php foreach ($rows as $row): ?>
                            <tr>
                                <td class="lp-board-rank"><?= (int) $row['rank'] ?></td>
                                <td class="lp-board-name"><?= $this->text->e($row['name']) ?></td>
                                <td class="lp-board-score"><?= (int) $row['score'] ?></td>
                            </tr>
                        <?php endforeach ?>
                    </table>
                <?php endif ?>
            </div>
        <?php endforeach ?>
    </section>
</div>
