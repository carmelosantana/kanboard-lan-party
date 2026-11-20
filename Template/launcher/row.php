<section class="lp-row">
    <h2 class="lp-row-title"><?= $this->text->e($label) ?></h2>
    <div class="lp-row-strip">
        <?php foreach ($games as $game): ?>
            <?= $this->render('LanParty:launcher/card', ['game' => $game, 'best' => $bests[$game['slug']] ?? null]) ?>
        <?php endforeach ?>
    </div>
</section>
