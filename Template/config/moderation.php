<div class="page-header"><h2><?= t('LAN Party scores') ?></h2></div>
<p class="form-help"><?= t('Games report their own scores, so a player can send one they did not earn. Remove a player\'s scores for a game, or leave the player empty to reset the whole board. This cannot be undone.') ?></p>
<?php if ($games === []): ?>
    <p class="alert"><?= t('No game keeps scores.') ?></p>
<?php else: ?>
<form method="post" action="<?= $this->url->href('ModerationController', 'remove', ['plugin' => 'LanParty']) ?>" autocomplete="off">
    <?= $this->form->csrf() ?>
    <label for="lp-mod-game"><?= t('Game') ?></label>
    <select id="lp-mod-game" name="game_slug" required>
        <?php foreach ($games as $slug => $title): ?>
        <option value="<?= $this->text->e($slug) ?>"><?= $this->text->e($title) ?></option>
        <?php endforeach ?>
    </select>
    <label for="lp-mod-user"><?= t('Player') ?></label>
    <select id="lp-mod-user" name="user_id">
        <option value=""><?= t('Everyone (reset the board)') ?></option>
        <?php foreach ($players as $id => $name): ?>
        <option value="<?= (int) $id ?>"><?= $this->text->e($name) ?></option>
        <?php endforeach ?>
    </select>
    <label><input type="checkbox" name="confirm" value="1" required> <?= t('Yes, delete these scores') ?></label>
    <div class="form-actions">
        <button type="submit" class="btn btn-red"><?= t('Remove scores') ?></button>
    </div>
</form>
<?php endif ?>
