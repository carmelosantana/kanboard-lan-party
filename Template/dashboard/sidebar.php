<li <?= $this->app->checkMenuSelection('LauncherController', 'index', 'LanParty') ?>>
    <?= $this->url->link(t('LAN Party'), 'LauncherController', 'index', ['plugin' => 'LanParty']) ?>
</li>
