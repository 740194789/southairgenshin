package com.southair.genshin.module.backup;

import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.module.resource.AccountResource;
import com.southair.genshin.module.resource.AccountResourceRepository;
import com.southair.genshin.module.wish.WishPitySnapshotRepository;
import com.southair.genshin.module.wish.WishRecord;
import com.southair.genshin.module.wish.WishRecordRepository;
import com.southair.genshin.module.wish.WishService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 数据备份：导出 / 导入（资源快照 + 抽卡记录）。
 *
 * <p>导入支持两种模式：</p>
 * <ul>
 *     <li>merge（默认）：保留现有抽卡记录，重复记录自动跳过；资源按备份覆盖</li>
 *     <li>replace：先清空当前账号的抽卡记录，再全量写入；资源按备份覆盖</li>
 * </ul>
 */
@Service
public class BackupService {

    private static final int BACKUP_VERSION = 4;
    private static final int FULL_BACKUP_VERSION = 5;
    private static final int MAX_RECORDS = 2000;
    private static final long MAX_PRIMOGEMS = 999_999_999L;
    private static final long MAX_FATES = 99_999L;

    private static final String[] GAMES = {GameType.GENSHIN, GameType.STAR_RAIL};

    private final WishRecordRepository wishRepository;
    private final AccountResourceRepository resourceRepository;
    private final WishPitySnapshotRepository pitySnapshotRepository;

    public BackupService(WishRecordRepository wishRepository,
                         AccountResourceRepository resourceRepository,
                         WishPitySnapshotRepository pitySnapshotRepository) {
        this.wishRepository = wishRepository;
        this.resourceRepository = resourceRepository;
        this.pitySnapshotRepository = pitySnapshotRepository;
    }

    @Transactional(readOnly = true)
    public BackupVO export(Long userId, String game) {
        String gameKey = GameType.normalize(game);
        BackupVO backup = new BackupVO();
        backup.setApp("SouthAir Genshin");
        backup.setVersion(BACKUP_VERSION);
        backup.setGame(gameKey);
        backup.setExportedAt(LocalDateTime.now());
        backup.setResource(resourceRepository.findByUserIdAndGame(userId, gameKey).orElse(null));
        backup.setWishes(wishRepository.findByUserIdAndGameOrderByWishTimeAsc(userId, gameKey));
        return backup;
    }

    @Transactional(readOnly = true)
    public FullBackupVO exportAll(Long userId) {
        FullBackupVO backup = new FullBackupVO();
        backup.setExportedAt(LocalDateTime.now());
        for (String game : GAMES) {
            backup.getGames().put(game, export(userId, game));
        }
        return backup;
    }

    /**
     * 全量导入：按游戏分别写入，结果合并统计。
     */
    @Transactional
    public ImportResultVO importAll(Long userId, FullBackupVO backup, String mode) {
        if (backup == null || backup.getGames() == null || backup.getGames().isEmpty()) {
            throw new BusinessException("全量备份文件中没有可导入的数据");
        }
        if (backup.getVersion() > FULL_BACKUP_VERSION) {
            throw new BusinessException("备份文件版本过新，请升级应用后再导入");
        }

        ImportResultVO total = new ImportResultVO();
        total.setMode("replace".equalsIgnoreCase(mode) ? "replace" : "merge");
        for (Map.Entry<String, BackupVO> entry : backup.getGames().entrySet()) {
            String raw = entry.getKey() == null ? "" : entry.getKey().trim().toLowerCase();
            if (!GameType.GENSHIN.equals(raw) && !GameType.STAR_RAIL.equals(raw)) {
                throw new BusinessException("备份文件中包含未知游戏：" + entry.getKey());
            }
            BackupVO gameBackup = entry.getValue();
            if (gameBackup == null) {
                continue;
            }
            // 空游戏（既没有资源也没有抽卡记录）直接跳过，不视为错误
            if (gameBackup.getResource() == null
                    && (gameBackup.getWishes() == null || gameBackup.getWishes().isEmpty())) {
                continue;
            }
            ImportResultVO result = importData(userId, raw, gameBackup, mode);
            total.setWishes(total.getWishes() + result.getWishes());
            total.setSkipped(total.getSkipped() + result.getSkipped());
            total.setResourceUpdated(total.isResourceUpdated() || result.isResourceUpdated());
        }
        return total;
    }

    @Transactional
    public ImportResultVO importData(Long userId, String game, BackupVO backup, String mode) {
        if (backup == null) {
            throw new BusinessException("导入内容为空");
        }
        if (backup.getVersion() > BACKUP_VERSION) {
            throw new BusinessException("备份文件版本过新，请升级应用后再导入");
        }
        String gameKey = GameType.normalize(game);

        List<WishRecord> wishes = backup.getWishes() == null
                ? Collections.emptyList() : backup.getWishes();
        if (backup.getResource() == null && wishes.isEmpty()) {
            throw new BusinessException("备份文件中没有可导入的记录");
        }
        if (wishes.size() > MAX_RECORDS) {
            throw new BusinessException("单次导入最多 " + MAX_RECORDS + " 条抽卡记录");
        }
        // 备份文件不含保底快照：恢复记录后旧快照会与新数据对不上，清空后按记录推导
        if (!wishes.isEmpty()) {
            pitySnapshotRepository.deleteByUserIdAndGame(userId, gameKey);
        }

        boolean replace = "replace".equalsIgnoreCase(mode);
        ImportResultVO result = new ImportResultVO();
        result.setMode(replace ? "replace" : "merge");

        if (backup.getResource() != null) {
            applyResource(userId, gameKey, backup.getResource());
            result.setResourceUpdated(true);
        }

        if (replace) {
            wishRepository.deleteAll(
                    wishRepository.findByUserIdAndGameOrderByWishTimeAsc(userId, gameKey));
        }

        Map<String, Integer> existingCounts = new HashMap<>();
        if (!replace) {
            for (WishRecord saved : wishRepository.findByUserIdAndGameOrderByWishTimeAsc(userId, gameKey)) {
                existingCounts.merge(backupKey(saved), 1, Integer::sum);
            }
        }

        int skipped = 0;
        Map<String, Integer> seen = new HashMap<>();
        for (WishRecord source : wishes) {
            int rarity = clamp(source.getRarity(), 1, 5, 3);
            // 只记录四星角色与五星物品，三星物品、四星武器 / 光锥直接忽略
            if (!WishService.isRecordable(rarity, trim(source.getItemType()))) {
                skipped++;
                continue;
            }
            // 缺名称时按星级给出默认名称
            String itemName = WishService.normalizeItemName(source.getItemName(), rarity);
            LocalDateTime wishTime = source.getWishTime() == null ? LocalDateTime.now() : source.getWishTime();
            String pool = trim(source.getPool());
            String uid = trim(source.getUid());
            String key = backupKey(uid, itemName, pool, wishTime);
            int seenCount = seen.containsKey(key) ? seen.get(key) : 0;
            if (!replace && existingCounts.getOrDefault(key, 0) > seenCount) {
                skipped++;
                seen.put(key, seenCount + 1);
                continue;
            }
            wishRepository.save(toWish(userId, gameKey, source, itemName, rarity, wishTime));
            result.setWishes(result.getWishes() + 1);
            seen.put(key, seenCount + 1);
        }

        result.setSkipped(skipped);
        return result;
    }

    private void applyResource(Long userId, String game, AccountResource source) {
        AccountResource target = resourceRepository.findByUserIdAndGame(userId, game).orElseGet(() -> {
            AccountResource created = new AccountResource();
            created.setUserId(userId);
            created.setGame(game);
            return created;
        });
        target.setPrimogems(clampLong(source.getPrimogems(), 0L, MAX_PRIMOGEMS, 0L));
        target.setMora(clampLong(source.getMora(), 0L, MAX_PRIMOGEMS, 0L));
        target.setIntertwinedFates(clampLong(source.getIntertwinedFates(), 0L, MAX_FATES, 0L));
        target.setAcquaintedFates(clampLong(source.getAcquaintedFates(), 0L, MAX_FATES, 0L));
        target.setGenesisCrystals(clampLong(source.getGenesisCrystals(), 0L, MAX_PRIMOGEMS, 0L));
        target.setDailyPrimogems(clampLong(source.getDailyPrimogems(), 0L, 999999L, 0L));
        target.setLastAccrualDate(LocalDate.now().toString());
        resourceRepository.save(target);
    }

    private WishRecord toWish(Long userId, String game, WishRecord source, String itemName, int rarity,
                              LocalDateTime wishTime) {
        WishRecord target = new WishRecord();
        target.setUserId(userId);
        target.setGame(game);
        target.setItemName(truncate(itemName, 64));
        target.setItemType(truncate(trim(source.getItemType()), 16));
        target.setPool(truncate(trim(source.getPool()), 16));
        target.setRarity(rarity);
        target.setIsUp(source.getIsUp() == null ? Boolean.FALSE : source.getIsUp());
        target.setPityCount(clamp(source.getPityCount(), 1, 90, 1));
        target.setWishTime(wishTime);
        target.setNote(truncate(trim(source.getNote()), 255));
        target.setCaptureTriggered(Boolean.TRUE.equals(source.getCaptureTriggered()));
        target.setUid(truncate(trim(source.getUid()), 32));
        return target;
    }

    private String backupKey(WishRecord record) {
        return backupKey(record.getUid(), record.getItemName(), record.getPool(), record.getWishTime());
    }

    private String backupKey(String uid, String itemName, String pool, LocalDateTime wishTime) {
        return (uid == null ? "" : uid) + "\u0001" + (itemName == null ? "" : itemName)
                + "\u0001" + (pool == null ? "" : pool) + "\u0001" + wishTime;
    }

    private String trim(String value) {
        return value == null ? null : value.trim();
    }

    private String truncate(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }

    private Integer clamp(Integer value, int min, int max, int defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        return Math.max(min, Math.min(max, value));
    }

    private long clampLong(Long value, long min, long max, long defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        return Math.max(min, Math.min(max, value));
    }
}
