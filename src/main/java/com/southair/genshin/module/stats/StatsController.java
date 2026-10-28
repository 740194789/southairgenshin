package com.southair.genshin.module.stats;

import com.southair.genshin.common.R;
import com.southair.genshin.security.UserContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/stats")
public class StatsController {

    private final StatsService statsService;

    public StatsController(StatsService statsService) {
        this.statsService = statsService;
    }

    @GetMapping("/overview")
    public R<OverviewVO> overview(@RequestParam(defaultValue = "genshin") String game) {
        return R.ok(statsService.overview(UserContext.require(), game));
    }
}
