package com.southair.genshin.module.resource;

import com.southair.genshin.common.GameType;
import com.southair.genshin.module.resource.dto.ResourceRequest;
import com.southair.genshin.module.resource.dto.ResourceVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 账号资源服务：读取时自动初始化，更新时按字段覆盖。
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
        return ResourceVO.of(getOrCreate(userId, GameType.normalize(game)), PRIMOGEMS_PER_PULL);
    }

    @Transactional
    public ResourceVO update(Long userId, String game, ResourceRequest request) {
        AccountResource entity = getOrCreate(userId, GameType.normalize(game));
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
        repository.save(entity);
        return ResourceVO.of(entity, PRIMOGEMS_PER_PULL);
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
            return repository.save(resource);
        });
    }
}
