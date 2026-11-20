<?php $min = $game['players']['min']; $max = $game['players']['max'] ?>
<a class="lp-card" href="<?= $this->url->href('LauncherController', 'game', ['plugin' => 'LanParty', 'slug' => $game['slug']]) ?>">
    <img class="lp-card-cover" src="<?= $this->text->e($this->url->dir().$game['base_url'].$game['art']['cover']) ?>" alt="" loading="lazy">
    <span class="lp-card-info">
        <span class="lp-card-title"><?= $this->text->e($game['title']) ?></span>
        <span class="lp-badge"><?= $min === $max && $min === 1 ? '1P' : $min.'–'.$max.'P' ?></span>
        <?php if ($best !== null): ?>
            <span class="lp-card-best"><?= t('Your best') ?> <?= $best ?></span>
        <?php endif ?>
    </span>
</a>
