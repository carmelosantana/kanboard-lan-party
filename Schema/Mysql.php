<?php
namespace Kanboard\Plugin\LanParty\Schema;

const VERSION = 1;

function version_1($pdo)
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS lanparty_scores (
        id INT NOT NULL AUTO_INCREMENT,
        game_slug VARCHAR(32) NOT NULL,
        user_id INT NOT NULL,
        score BIGINT NOT NULL,
        level VARCHAR(32) NULL,
        seed VARCHAR(64) NULL,
        meta TEXT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY(id),
        INDEX lanparty_scores_game_score_idx (game_slug, score),
        INDEX lanparty_scores_user_game_idx (user_id, game_slug),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB CHARSET=utf8mb4');
}
