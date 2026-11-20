<div class="lp-launcher">
<?php if ($hero === null): ?>
    <p class="lp-empty"><?= t('No games installed') ?></p>
<?php else: ?>
    <section class="lp-hero">
        <img class="lp-hero-art" src="<?= $this->text->e($this->url->dir().$hero['base_url'].($hero['art']['hero'] ?? $hero['art']['cover'])) ?>" alt="">
        <div class="lp-hero-body">
            <h1 class="lp-hero-title"><?= $this->text->e($hero['title']) ?></h1>
            <?php if (! empty($hero['tagline'])): ?>
                <p class="lp-tagline"><?= $this->text->e($hero['tagline']) ?></p>
            <?php endif ?>
            <?= $this->url->link(t('Play'), 'LauncherController', 'game', ['plugin' => 'LanParty', 'slug' => $hero['slug']], false, 'lp-button') ?>
        </div>
    </section>
    <?php foreach ($rows as $label => $games): ?>
        <?= $this->render('LanParty:launcher/row', ['label' => $label, 'games' => $games, 'bests' => $bests]) ?>
    <?php endforeach ?>
<?php endif ?>
</div>
