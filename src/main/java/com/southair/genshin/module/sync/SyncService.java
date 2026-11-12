package com.southair.genshin.module.sync;

import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.module.resource.AccountResource;
import com.southair.genshin.module.resource.AccountResourceRepository;
import com.southair.genshin.module.sync.dto.SyncMergeRequest;
import com.southair.genshin.module.sync.dto.SyncRecordDTO;
import com.southair.genshin.module.sync.dto.SyncResourceDTO;
import com.southair.genshin.module.sync.dto.SyncSnapshotVO;
import com.southair.genshin.module.wish.WishRecord;
import com.southair.genshin.module.wish.WishRecordRepository;
import com.southair.genshin.module.wish.WishService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 多端同步：离线优先的全量快照 + 按客户端编辑时间的合并（LWW）。
 *
 * <p>每个账号在每个游戏下只看到自己的数据，删除通过墓碑表记录，防止旧数据复活。</p>
 */
@Service
public class SyncService {

    /** 单次合并最多处理的记录数 */
    private static final int MAX_MERGE_RECORDS = 5000;

    private final WishRecordRepository wishRepository;
    private final AccountResourceRepository resourceRepository;
    private final SyncTombstoneRepository tombstoneRepository;

    public SyncService(WishRecordRepository wishRepository,
                       AccountResourceRepository resourceRepository,
                       SyncTombstoneRepository tombstoneRepository) {
        this.wishRepository = wishRepository;
        this.resourceRepository = resourceRepository;
        this.tombstoneRepository = tombstoneRepository;
    }

    @Transactional
    public SyncSnapshotVO snapshot(Long userId, String game) {
        String gameKey = GameType.normalize(game);
        return buildSnapshot(userId, gameKey);
    }

    /**
     * 合并客户端数据，返回合并后的服务端全量快照。
     */
    @Transactional
    public SyncSnapshotVO merge(Long userId, String game, SyncMergeRequest request) {
        String gameKey = GameType.normalize(game);
        List<SyncRecordDTO> incoming = request == null ? null : request.getRecords();
        if (incoming != null && incoming.size() > MAX_MERGE_RECORDS) {
            throw new BusinessException("单次同步最多 " + MAX_MERGE_RECORDS + " 条记录");
        }

        mergeResource(userId, gameKey, request == null ? null : request.getResource());
        if (incoming != null) {
            for (SyncRecordDTO record : incoming) {
                if (record != null) {
                    mergeRecord(userId, gameKey, record);
                }
            }
        }
        return buildSnapshot(userId, gameKey);
    }

    private void mergeResource(Long userId, String game, SyncResourceDTO incoming) {
        AccountResource entity = resourceRepository.findByUserIdAndGame(userId, game).orElse(null);
        if (entity == null) {
            entity = new AccountResource();
            entity.setUserId(userId);
            entity.setGame(game);
            entity.setPrimogems(0L);
            entity.setMora(0L);
            entity.setIntertwinedFates(0L);
            entity.setAcquaintedFates(0L);
            if (incoming != null) {
                applyResource(entity, incoming);
                entity.setEditedAt(incoming.getEditedAt() != null
                        ? incoming.getEditedAt() : System.currentTimeMillis());
            }
            resourceRepository.save(entity);
            return;
        }

        if (incoming == null) {
            return;
        }
        long incomingAt = incoming.getEditedAt() == null ? 0L : incoming.getEditedAt();
        long existingAt = entity.getEditedAt() == null ? 0L : entity.getEditedAt();
        if (incomingAt > existingAt) {
            applyResource(entity, incoming);
            entity.setEditedAt(incomingAt == 0L ? System.currentTimeMillis() : incomingAt);
            resourceRepository.save(entity);
        }
    }

    private void applyResource(AccountResource entity, SyncResourceDTO incoming) {
        if (incoming.getPrimogems() != null) {
            entity.setPrimogems(Math.max(0L, incoming.getPrimogems()));
        }
        if (incoming.getMora() != null) {
            entity.setMora(Math.max(0L, incoming.getMora()));
        }
        if (incoming.getIntertwinedFates() != null) {
            entity.setIntertwinedFates(Math.max(0L, incoming.getIntertwinedFates()));
        }
        if (incoming.getAcquaintedFates() != null) {
            entity.setAcquaintedFates(Math.max(0L, incoming.getAcquaintedFates()));
        }
        if (incoming.getGenesisCrystals() != null) {
            entity.setGenesisCrystals(Math.max(0L, incoming.getGenesisCrystals()));
        }
        if (incoming.getHeroWit() != null) {
            entity.setHeroWit(Math.max(0L, incoming.getHeroWit()));
        }
        if (incoming.getAdventurerExp() != null) {
            entity.setAdventurerExp(Math.max(0L, incoming.getAdventurerExp()));
        }
        if (incoming.getWandererAdvice() != null) {
            entity.setWandererAdvice(Math.max(0L, incoming.getWandererAdvice()));
        }
        if (incoming.getSanctifyingUnction() != null) {
            entity.setSanctifyingUnction(Math.max(0L, incoming.getSanctifyingUnction()));
        }
        if (incoming.getSanctifyingEssence() != null) {
            entity.setSanctifyingEssence(Math.max(0L, incoming.getSanctifyingEssence()));
        }
    }

    private void mergeRecord(Long userId, String game, SyncRecordDTO incoming) {
        String clientUid = StringUtils.hasText(incoming.getClientUid())
                ? incoming.getClientUid().trim() : null;
        if (clientUid == null) {
            // 没有稳定标识的记录无法跨端对齐，直接忽略
            return;
        }
        clientUid = clientUid.length() <= 64 ? clientUid : clientUid.substring(0, 64);
        long at = incoming.getEditedAt() == null ? System.currentTimeMillis() : incoming.getEditedAt();

        WishRecord existing = wishRepository
                .findFirstByUserIdAndGameAndClientUid(userId, game, clientUid).orElse(null);
        if (existing != null) {
            long existingAt = existing.getEditedAt() == null ? 0L : existing.getEditedAt();
            if (at <= existingAt) {
                return;
            }
            if (Boolean.TRUE.equals(incoming.getDeleted())) {
                upsertTombstone(userId, game, clientUid, at);
                wishRepository.delete(existing);
                return;
            }
            applyRecord(existing, incoming);
            existing.setEditedAt(at);
            wishRepository.save(existing);
            return;
        }

        if (Boolean.TRUE.equals(incoming.getDeleted())) {
            upsertTombstone(userId, game, clientUid, at);
            return;
        }

        SyncTombstone tombstone = tombstoneRepository
                .findFirstByUserIdAndGameAndClientUid(userId, game, clientUid).orElse(null);
        if (tombstone != null) {
            long tombstoneAt = tombstone.getEditedAt() == null ? 0L : tombstone.getEditedAt();
            if (at <= tombstoneAt) {
                // 这条记录已经在其他端删除，且客户端没有更新的修改
                return;
            }
            tombstoneRepository.delete(tombstone);
        }

        String itemName = WishService.normalizeItemName(incoming.getItemName(), incoming.getRarity());
        String pool = truncate(incoming.getPool(), 16);
        LocalDateTime wishTime = incoming.getWishTime();
        if (wishTime == null) {
            wishTime = LocalDateTime.now();
        }
        if (wishRepository.countDuplicate(userId, game, itemName, pool, wishTime) > 0) {
            return;
        }

        WishRecord record = new WishRecord();
        record.setUserId(userId);
        record.setGame(game);
        record.setClientUid(clientUid);
        record.setEditedAt(at);
        applyRecord(record, incoming);
        record.setItemName(itemName);
        record.setPool(pool);
        record.setWishTime(wishTime);
        wishRepository.save(record);
    }

    private void applyRecord(WishRecord target, SyncRecordDTO source) {
        int rarity = clamp(source.getRarity(), 1, 5, 3);
        target.setItemName(WishService.normalizeItemName(source.getItemName(), rarity));
        target.setItemType(truncate(trim(source.getItemType()), 16));
        target.setPool(truncate(trim(source.getPool()), 16));
        target.setRarity(rarity);
        target.setIsUp(source.getIsUp() == null ? Boolean.FALSE : source.getIsUp());
        target.setPityCount(clamp(source.getPityCount(), 1, 90, 1));
        target.setWishTime(source.getWishTime());
        target.setNote(truncate(trim(source.getNote()), 255));
    }

    private void upsertTombstone(Long userId, String game, String clientUid, long editedAt) {
        SyncTombstone tombstone = tombstoneRepository
                .findFirstByUserIdAndGameAndClientUid(userId, game, clientUid)
                .orElseGet(SyncTombstone::new);
        long existingAt = tombstone.getEditedAt() == null ? 0L : tombstone.getEditedAt();
        if (editedAt <= existingAt) {
            return;
        }
        tombstone.setUserId(userId);
        tombstone.setGame(game);
        tombstone.setClientUid(clientUid);
        tombstone.setEditedAt(editedAt);
        tombstoneRepository.save(tombstone);
    }

    private SyncSnapshotVO buildSnapshot(Long userId, String game) {
        AccountResource resource = resourceRepository.findByUserIdAndGame(userId, game).orElse(null);
        SyncSnapshotVO snapshot = new SyncSnapshotVO();
        snapshot.setGame(game);
        snapshot.setServerTime(System.currentTimeMillis());
        snapshot.setResource(toResourceDTO(resource));

        List<WishRecord> records = wishRepository
                .findByUserIdAndGameOrderByWishTimeAsc(userId, game);
        List<SyncRecordDTO> result = new ArrayList<>(records.size());
        for (WishRecord record : records) {
            result.add(toRecordDTO(record));
        }
        snapshot.setRecords(result);
        return snapshot;
    }

    private SyncResourceDTO toResourceDTO(AccountResource entity) {
        SyncResourceDTO dto = new SyncResourceDTO();
        if (entity == null) {
            dto.setPrimogems(0L);
            dto.setMora(0L);
            dto.setIntertwinedFates(0L);
            dto.setAcquaintedFates(0L);
            dto.setGenesisCrystals(0L);
            dto.setEditedAt(0L);
            return dto;
        }
        dto.setPrimogems(nvl(entity.getPrimogems()));
        dto.setMora(nvl(entity.getMora()));
        dto.setIntertwinedFates(nvl(entity.getIntertwinedFates()));
        dto.setAcquaintedFates(nvl(entity.getAcquaintedFates()));
        dto.setGenesisCrystals(nvl(entity.getGenesisCrystals()));
        dto.setHeroWit(nvl(entity.getHeroWit()));
        dto.setAdventurerExp(nvl(entity.getAdventurerExp()));
        dto.setWandererAdvice(nvl(entity.getWandererAdvice()));
        dto.setSanctifyingUnction(nvl(entity.getSanctifyingUnction()));
        dto.setSanctifyingEssence(nvl(entity.getSanctifyingEssence()));
        dto.setEditedAt(entity.getEditedAt() == null ? 0L : entity.getEditedAt());
        return dto;
    }

    private SyncRecordDTO toRecordDTO(WishRecord record) {
        SyncRecordDTO dto = new SyncRecordDTO();
        dto.setClientUid(record.getClientUid());
        dto.setItemName(record.getItemName());
        dto.setItemType(record.getItemType());
        dto.setPool(record.getPool());
        dto.setRarity(record.getRarity());
        dto.setIsUp(record.getIsUp());
        dto.setPityCount(record.getPityCount());
        dto.setWishTime(record.getWishTime());
        dto.setNote(record.getNote());
        dto.setEditedAt(record.getEditedAt() == null ? 0L : record.getEditedAt());
        return dto;
    }

    private long nvl(Long value) {
        return value == null ? 0L : value;
    }

    private int clamp(Integer value, int min, int max, int defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        return Math.max(min, Math.min(max, value));
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
}
