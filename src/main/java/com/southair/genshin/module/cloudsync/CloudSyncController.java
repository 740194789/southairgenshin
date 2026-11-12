package com.southair.genshin.module.cloudsync;

import com.southair.genshin.common.R;
import com.southair.genshin.module.cloudsync.dto.CloudSyncPushRequest;
import com.southair.genshin.module.cloudsync.dto.CloudSyncRequest;
import com.southair.genshin.security.UserContext;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 云同步接口：电脑端负责与本机数据合并，云端只存密文。
 *
 * <p>拉取得到的 payload 交给 /api/backup/import-all 合并；
 * 推送前用 /api/backup/export-all 重新导出，保证推上去的是合并后的完整数据。</p>
 */
@RestController
@RequestMapping("/api/cloud-sync")
public class CloudSyncController {

    private final CloudSyncService cloudSyncService;

    public CloudSyncController(CloudSyncService cloudSyncService) {
        this.cloudSyncService = cloudSyncService;
    }

    @PostMapping("/create")
    public R<Map<String, Object>> create(@RequestBody CloudSyncRequest request) {
        UserContext.require();
        return R.ok(cloudSyncService.create(request.getServiceUrl()));
    }

    @PostMapping("/pull")
    public R<Map<String, Object>> pull(@RequestBody CloudSyncRequest request) {
        UserContext.require();
        return R.ok(cloudSyncService.pull(request.getServiceUrl(), request.getCode()));
    }

    @PostMapping("/push")
    public R<Map<String, Object>> push(@RequestBody CloudSyncPushRequest request) {
        UserContext.require();
        return R.ok(cloudSyncService.push(request.getServiceUrl(), request.getCode(),
                request.getPayload(), request.getPrevUpdatedAt()));
    }

    @PostMapping("/delete")
    public R<Void> delete(@RequestBody CloudSyncRequest request) {
        UserContext.require();
        cloudSyncService.delete(request.getServiceUrl(), request.getCode());
        return R.ok();
    }
}
