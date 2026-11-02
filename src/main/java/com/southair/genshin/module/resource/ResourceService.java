package com.southair.genshin.module.resource;

import com.southair.genshin.common.GameType;
import com.southair.genshin.module.resource.dto.ResourceRequest;
import com.southair.genshin.module.resource.dto.ResourceVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/**
 * 账号资源服务：读取时自动初始化并按自然日累积每日原石，更新时按字段覆盖。
 *
 * <p>资源按游戏隔离（原神 / 崩坏：星穹铁道）。</p>
 */
@Service
public class ResourceService {

    /** 1 抽 = 160 原石 / 星琼 */
    public static final int PRIMOGEMS_PER_PULL = 160;

    private final AccountResourceRepository repository;

    public ResourceService(AccountResourceRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public ResourceVO get(Long userId, String game) {
        AccountResource entity = getOrCreate(userId, GameType.normalize(game));
        accrue(entity);
        return ResourceVO.of(entity, PRIMOGEMS_PER_PULL);
    }

    @Transactional
    public ResourceVO update(Long userId, String game, ResourceRequest request) {
        AccountResource entity = getOrCreate(userId, GameType.normalize(game));
        // 先把上次读取以来应得的部分结算掉，再应用本次修改
        accrue(entity);
        if (request.getPrimogems() != null) {
            entity.setPrimogems(request.getPrimogems());
        }
        if (request.getMora() != null) {
            entity.setMora(request.getMora());
        }
        if (request.getIntertwinedFates() != null) {
            entity.setIntertwinedFates(request.getIntertwinedFates());
        }
        if (request.getAcquaintedFates() != null) {
            entity.setAcquaintedFates(request.getAcquaintedFates());
        }
        if (request.getDailyPrimogems() != null) {
            entity.setDailyPrimogems(request.getDailyPrimogems());
        }
        // 手动修改资产或每日额度后，从今天重新开始累积，避免补发历史差额
        if (request.getPrimogems() != null || request.getDailyPrimogems() != null) {
            entity.setLastAccrualDate(LocalDate.now().toString());
        }
        repository.save(entity);
        return ResourceVO.of(entity, PRIMOGEMS_PER_PULL);
    }

    /**
     * 按自然日累积每日原石：从上次累积日期到今天的整日差额 × 每日额度。
     * 首次读取只记录基准日期，不补发注册前的额度。
     */
    private void accrue(AccountResource entity) {
        LocalDate today = LocalDate.now();
        String lastText = entity.getLastAccrualDate();
        if (!StringUtils.hasText(lastText)) {
            entity.setLastAccrualDate(today.toString());
            repository.save(entity);
            return;
        }
        LocalDate last;
        try {
            last = LocalDate.parse(lastText);
        } catch (Exception e) {
            entity.setLastAccrualDate(today.toString());
            repository.save(entity);
            return;
        }
        long days = ChronoUnit.DAYS.between(last, today);
        if (days <= 0) {
            return;
        }
        long daily = nvl(entity.getDailyPrimogems());
        if (daily > 0) {
            entity.setPrimogems(nvl(entity.getPrimogems()) + daily * days);
        }
        entity.setLastAccrualDate(today.toString());
        repository.save(entity);
    }

    private AccountResource getOrCreate(Long userId, String game) {
        return repository.findByUserIdAndGame(userId, game).orElseGet(() -> {
            AccountResource resource = new AccountResource();
            resource.setUserId(userId);
            resource.setGame(game);
            resource.setPrimogems(0L);
            resource.setMora(0L);
            resource.setIntertwinedFates(0L);
            resource.setAcquaintedFates(0L);
            resource.setDailyPrimogems(0L);
            resource.setLastAccrualDate(LocalDate.now().toString());
            return repository.save(resource);
        });
    }

    private static long nvl(Long value) {
        return value == null ? 0L : value;
    }
}
