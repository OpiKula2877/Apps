package cz.opikula.okpass;

import android.app.Activity;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;

/**
 * Google authorization for Drive (scope drive.file) through Google Play services.
 * Google matches this app by its package name and signing certificate (Android OAuth client),
 * so no client secret is stored in the app. After the first consent, new access tokens are
 * handed out without any UI.
 */
@CapacitorPlugin(name = "OkpassAuth")
public class OkpassAuthPlugin extends Plugin {

    private static final String DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";

    private ActivityResultLauncher<IntentSenderRequest> consent;
    private PluginCall pending;

    @Override
    public void load() {
        consent = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), this::onConsent);
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(DRIVE_FILE)))
            .build();
        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (!result.hasResolution()) {
                    resolveToken(call, result);
                    return;
                }
                if (!interactive || result.getPendingIntent() == null) {
                    call.reject("Consent needed", "NEEDS_CONSENT");
                    return;
                }
                if (pending != null) pending.reject("Replaced by a new request", "CANCELED");
                pending = call;
                consent.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build());
            })
            .addOnFailureListener(error -> reject(call, error));
    }

    private void onConsent(ActivityResult activityResult) {
        PluginCall call = pending;
        pending = null;
        if (call == null) return;
        if (activityResult.getResultCode() != Activity.RESULT_OK) {
            call.reject("Sign-in cancelled", "CANCELED");
            return;
        }
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(getActivity())
                .getAuthorizationResultFromIntent(activityResult.getData());
            resolveToken(call, result);
        } catch (ApiException error) {
            reject(call, error);
        }
    }

    private void resolveToken(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null) {
            call.reject("No access token", "ERROR");
            return;
        }
        JSObject out = new JSObject();
        out.put("accessToken", token);
        call.resolve(out);
    }

    private void reject(PluginCall call, Exception error) {
        String code = "ERROR";
        if (error instanceof ApiException) {
            int status = ((ApiException) error).getStatusCode();
            if (status == CommonStatusCodes.NETWORK_ERROR || status == CommonStatusCodes.TIMEOUT) code = "OFFLINE";
            else if (status == CommonStatusCodes.SIGN_IN_REQUIRED || status == CommonStatusCodes.RESOLUTION_REQUIRED) code = "NEEDS_CONSENT";
            else if (status == CommonStatusCodes.CANCELED) code = "CANCELED";
        }
        String message = error.getMessage() == null ? code : error.getMessage();
        call.reject(message, code, error);
    }
}
