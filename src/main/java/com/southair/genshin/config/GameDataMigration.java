package com.southair.genshin.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 多游戏数据迁移：为旧数据补上 game 字段，并放开「每用户一条资源」的唯一约束。
 *
 * <p>旧版本只有原神数据，历史记录统一归入 genshin。</p>
 */
@Component
public class GameDataMigration implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(GameDataMigration.class);
    private static final String GENSHIN = "genshin";

    private final JdbcTemplate jdbcTemplate;

    public GameDataMigration(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        dropLegacyUniqueConstraint();

        jdbcTemplate.update("update t_wish_record set game = ? where game is null", GENSHIN);
        jdbcTemplate.update("update t_account_resource set game = ? where game is null", GENSHIN);

        try {
            jdbcTemplate.execute("create unique index if not exists ux_resource_user_game"
                    + " on t_account_resource (user_id, game)");
        } catch (Exception e) {
            log.warn("创建资源唯一索引失败，可能已存在：{}", e.getMessage());
        }
        log.info("多游戏数据迁移完成");
    }

    private void dropLegacyUniqueConstraint() {
        try {
            jdbcTemplate.execute("alter table t_account_resource drop constraint if exists uk_resource_user");
        } catch (Exception e) {
            // MySQL 的唯一约束以索引形式存在，改用 DROP INDEX
            try {
                jdbcTemplate.execute("alter table t_account_resource drop index uk_resource_user");
            } catch (Exception ignored) {
                // 全新数据库没有该约束，忽略
            }
        }
    }
}
