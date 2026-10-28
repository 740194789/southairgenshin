package com.southair.genshin.module.wish;

import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.common.PageResult;
import com.southair.genshin.module.wish.dto.WishBatchRequest;
import com.southair.genshin.module.wish.dto.WishImportResult;
import com.southair.genshin.module.wish.dto.WishRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class WishService {

    private static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_IMPORT_RECORDS = 2000;

    private final WishRecordRepository repository;

    public WishService(WishRecordRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public PageResult<WishRecord> page(Long userId, String game, String pool, int page, int size) {
        String gameKey = GameType.normalize(game);
        Pageable pageable = PageRequest.of(Math.max(page - 1, 0), normalizeSize(size),
                Sort.by(Sort.Direction.DESC, "wishTime").and(Sort.by(Sort.Direction.DESC, "id")));

        Page<WishRecord> result = StringUtils.hasText(pool)
                ? repository.findByUserIdAndGameAndPool(userId, gameKey, pool.trim(), pageable)
                : repository.findByUserIdAndGame(userId, gameKey, pageable);
        return PageResult.of(result);
    }

    @Transactional(readOnly = true)
    public WishRecord get(Long userId, Long id) {
        return findOwned(userId, id);
    }

    @Transactional
    public WishRecord create(Long userId, String game, WishRequest request) {
        WishRecord record = new WishRecord();
        record.setUserId(userId);
        record.setGame(GameType.normalize(game));
        apply(record, request);
        if (record.getWishTime() == null) {
            record.setWishTime(LocalDateTime.now());
        }
        return repository.save(record);
    }

    /**
     * 十连批量新增（最多 10 条）。
     */
    @Transactional
    public List<WishRecord> createBatch(Long userId, String game, WishBatchRequest request) {
        String gameKey = GameType.normalize(game);
        List<WishRecord> saved = new ArrayList<>();
        LocalDateTime fallbackTime = LocalDateTime.now();
        for (WishRequest item : request.getRecords()) {
            WishRecord record = new WishRecord();
            record.setUserId(userId);
            record.setGame(gameKey);
            apply(record, item);
            if (record.getWishTime() == null) {
                record.setWishTime(fallbackTime);
            }
            saved.add(repository.save(record));
        }
        return saved;
    }

    /**
     * 批量编辑已有记录，每条请求必须带 id。
     */
    @Transactional
    public List<WishRecord> updateBatch(Long userId, WishBatchRequest request) {
        List<WishRecord> updated = new ArrayList<>();
        for (WishRequest item : request.getRecords()) {
            if (item.getId() == null) {
                throw new BusinessException("批量编辑缺少记录 ID");
            }
            updated.add(update(userId, item.getId(), item));
        }
        return updated;
    }

    @Transactional
    public WishRecord update(Long userId, Long id, WishRequest request) {
        WishRecord record = findOwned(userId, id);
        apply(record, request);
        if (record.getWishTime() == null) {
            record.setWishTime(LocalDateTime.now());
        }
        return repository.save(record);
    }

    @Transactional
    public void delete(Long userId, Long id) {
        repository.delete(findOwned(userId, id));
    }

    /** 批量删除：逐条校验归属，任一不属于当前用户则整体回滚。 */
    @Transactional
    public void deleteBatch(Long userId, List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            throw new BusinessException("未选择要删除的记录");
        }
        for (Long id : ids) {
            repository.delete(findOwned(userId, id));
        }
    }

    @Transactional(readOnly = true)
    public List<WishRecord> exportAll(Long userId, String game) {
        return repository.findByUserIdAndGameOrderByWishTimeAsc(userId, GameType.normalize(game));
    }

    /**
     * 导入抽卡记录。
     *
     * <p>merge 模式下按「名称 + 卡池 + 时间」判重，并保留同名同时间的多条记录，
     * 避免十连中多件三星物品被误判为重复。</p>
     */
    @Transactional
    public WishImportResult importRecords(Long userId, String game, List<WishRecord> records, String mode) {
        if (records == null || records.isEmpty()) {
            throw new BusinessException("文件中没有可导入的抽卡记录");
        }
        if (records.size() > MAX_IMPORT_RECORDS) {
            throw new BusinessException("单次导入最多 " + MAX_IMPORT_RECORDS + " 条抽卡记录");
        }

        String gameKey = GameType.normalize(game);
        boolean replace = "replace".equalsIgnoreCase(mode);
        if (replace) {
            repository.deleteAll(repository.findByUserIdAndGameOrderByWishTimeAsc(userId, gameKey));
        }

        WishImportResult result = new WishImportResult();
        result.setMode(replace ? "replace" : "merge");

        Map<String, Integer> seen = new HashMap<>();
        for (WishRecord source : records) {
            int rarity = clamp(source.getRarity(), 1, 5, 3);
            String itemName = normalizeItemName(source.getItemName(), rarity);
            String pool = trim(source.getPool());
            LocalDateTime wishTime = source.getWishTime() == null ? LocalDateTime.now() : source.getWishTime();
            String key = itemName + "\u0001" + (pool == null ? "" : pool) + "\u0001" + wishTime;

            int seenCount = seen.containsKey(key) ? seen.get(key) : 0;
            if (!replace && repository.countDuplicate(userId, gameKey, itemName, pool, wishTime) > seenCount) {
                result.setSkipped(result.getSkipped() + 1);
                seen.put(key, seenCount + 1);
                continue;
            }

            repository.save(toRecord(userId, gameKey, source, itemName, pool, rarity, wishTime));
            result.setImported(result.getImported() + 1);
            seen.put(key, seenCount + 1);
        }
        return result;
    }

    /**
     * 三星（蓝色）允许不填名称，按星级给出默认名称。
     */
    public static String normalizeItemName(String name, Integer rarity) {
        String trimmed = name == null ? null : name.trim();
        if (StringUtils.hasText(trimmed)) {
            return trimmed.length() <= 64 ? trimmed : trimmed.substring(0, 64);
        }
        int value = rarity == null ? 3 : rarity;
        if (value >= 5) {
            return "五星物品";
        }
        if (value == 4) {
            return "四星物品";
        }
        return "三星物品";
    }

    private WishRecord toRecord(Long userId, String game, WishRecord source, String itemName, String pool,
                                int rarity, LocalDateTime wishTime) {
        WishRecord target = new WishRecord();
        target.setUserId(userId);
        target.setGame(game);
        target.setItemName(itemName);
        target.setItemType(truncate(trim(source.getItemType()), 16));
        target.setPool(truncate(pool, 16));
        target.setRarity(rarity);
        target.setIsUp(source.getIsUp() == null ? Boolean.FALSE : source.getIsUp());
        target.setPityCount(clamp(source.getPityCount(), 1, 180, 1));
        target.setWishTime(wishTime);
        target.setNote(truncate(trim(source.getNote()), 255));
        return target;
    }

    private WishRecord findOwned(Long userId, Long id) {
        WishRecord record = repository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "抽卡记录不存在"));
        if (!record.getUserId().equals(userId)) {
            throw new BusinessException(403, "无权操作该记录");
        }
        return record;
    }

    private void apply(WishRecord record, WishRequest request) {
        int rarity = request.getRarity() == null ? 3 : request.getRarity();
        record.setItemName(normalizeItemName(request.getItemName(), rarity));
        record.setItemType(request.getItemType());
        record.setPool(request.getPool());
        record.setRarity(rarity);
        record.setIsUp(request.getIsUp() == null ? Boolean.FALSE : request.getIsUp());
        record.setPityCount(request.getPityCount() == null ? 1 : request.getPityCount());
        record.setWishTime(request.getWishTime());
        record.setNote(request.getNote());
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

    private int normalizeSize(int size) {
        if (size <= 0) {
            return 10;
        }
        return Math.min(size, MAX_PAGE_SIZE);
    }
}
