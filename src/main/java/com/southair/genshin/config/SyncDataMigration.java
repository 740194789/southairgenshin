package com.southair.genshin.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * 同步字段迁移：为存量抽卡记录补 clientUid / editedAt，为存量资源补 editedAt。
 */
@Component
public class SyncDataMigration implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SyncDataMigration.class);

    private final JdbcTemplate jdbcTemplate;

    public SyncDataMigration(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        fillClientUid();
        long now = System.currentTimeMillis();
        jdbcTemplate.update("update t_wish_record set edited_at = ? where edited_at is null", now);
        jdbcTemplate.update("update t_account_resource set edited_at = ? where edited_at is null", now);
        log.info("同步字段迁移完成");
    }

    private void fillClientUid() {
        List<Long> ids = jdbcTemplate.queryForList(
                "select id from t_wish_record where client_uid is null", Long.class);
        for (Long id : ids) {
            jdbcTemplate.update("update t_wish_record set client_uid = ? where id = ?",
                    UUID.randomUUID().toString(), id);
        }
        if (!ids.isEmpty()) {
            log.info("已为 {} 条存量抽卡记录补充 clientUid", ids.size());
        }
    }
}
