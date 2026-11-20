<?php if ($this->user->getId()): ?>
<li>
    <?= $this->url->icon('gamepad', t('LAN Party'), 'LauncherController', 'index', ['plugin' => 'LanParty']) ?>
</li>
<?php endif ?>
