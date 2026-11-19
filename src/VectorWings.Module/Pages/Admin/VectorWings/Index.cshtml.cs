using MatGame.Sdk;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace VectorWings.Module.Pages.Admin;

[Authorize(Policy = GameAccounts.AdminPolicy)]
public sealed class IndexModel(RoomRegistry rooms, ProgressStore store, IGameAccounts accounts) : PageModel
{
    [BindProperty(SupportsGet = true)] public string? Query { get; set; }
    [BindProperty(SupportsGet = true)] public string? Sort { get; set; }
    [BindProperty(SupportsGet = true)] public string? View { get; set; }
    public RoomListing[] Rooms { get; private set; } = [];
    public ResultRow[] Results { get; private set; } = [];
    public ProgressRow[] Players { get; private set; } = [];

    public async Task<IActionResult> OnGetAsync(CancellationToken ct)
    {
        var actor = User.ToAccount();
        if (actor?.IsAdmin != true) return Forbid();
        var overview = await AdminLogic.OverviewAsync(actor, rooms, store, accounts, Query, Sort, View, ct);
        Rooms = overview.Rooms;
        Results = overview.Results;
        Players = overview.Players;
        return Page();
    }

    public IActionResult OnPostEnd(string code)
    {
        var actor = User.ToAccount();
        if (actor?.IsAdmin != true) return Forbid();
        AdminLogic.End(actor, rooms, code);
        return RedirectToPage();
    }
}

internal static class AdminLogic
{
    public static async Task<(RoomListing[] Rooms, ResultRow[] Results, ProgressRow[] Players)> OverviewAsync(
        GameAccount actor, RoomRegistry rooms, ProgressStore store, IGameAccounts accounts, string? query, string? sort, string? view, CancellationToken ct)
    {
        DemandAdmin(actor);
        var live = view == "history" || view == "players" ? [] : rooms.Inspect()
            .Where(room => Matches(room.Code, query) || Matches(room.Mission, query))
            .OrderBy(room => room.Code).ToArray();
        var history = view == "live" || view == "players" ? [] : (await store.ResultsAsync(ct))
            .Where(result => Matches(result.Mode, query) || Matches(result.Id.ToString(), query)).ToArray();
        var players = view == "live" || view == "history" ? [] : (await store.PlayersAsync(accounts, ct))
            .Where(player => Matches(player.Name, query) || Matches(player.AccountId.ToString(), query)).ToArray();
        return (live, history, sort == "score" ? players.OrderByDescending(player => player.Progress.BestScore).ToArray()
            : players.OrderBy(player => player.Name, StringComparer.CurrentCultureIgnoreCase).ToArray());
    }

    public static void End(GameAccount actor, RoomRegistry rooms, string code)
    {
        DemandAdmin(actor);
        if (!string.IsNullOrWhiteSpace(code)) rooms.Abort(code);
    }

    private static bool Matches(string value, string? query) =>
        string.IsNullOrWhiteSpace(query) || value.Contains(query.Trim(), StringComparison.CurrentCultureIgnoreCase);

    private static void DemandAdmin(GameAccount actor)
    {
        if (!actor.IsAdmin) throw new UnauthorizedAccessException();
    }
}
