package com.southair.genshin.module.sync;

import com.southair.genshin.common.R;
import com.southair.genshin.module.sync.dto.SyncMergeRequest;
import com.southair.genshin.module.sync.dto.SyncSnapshotVO;
import com.southair.genshin.security.UserContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 多端同步接口（需登录）。
 *
 * <ul>
 *   <li>GET /api/sync/snapshot?game= 拉取服务端全量快照</li>
 *   <li>POST /api/sync/merge?game= 上传本地数据并返回合并后的快照</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/sync")
public class SyncController {

    private final SyncService syncService;

    public SyncController(SyncService syncService) {
        this.syncService = syncService;
    }

    @GetMapping("/snapshot")
    public R<SyncSnapshotVO> snapshot(@RequestParam(defaultValue = "genshin") String game) {
        return R.ok(syncService.snapshot(UserContext.require(), game));
    }

    @PostMapping("/merge")
    public R<SyncSnapshotVO> merge(@RequestBody(required = false) SyncMergeRequest request,
                                   @RequestParam(defaultValue = "genshin") String game) {
        return R.ok(syncService.merge(UserContext.require(), game, request));
    }
}
